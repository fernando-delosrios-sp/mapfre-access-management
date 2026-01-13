import {
    createConnector,
    readConfig,
    logger,
    ConnectorError,
    StdTestConnectionHandler,
    StdEntitlementListHandler,
    StdAccountCreateHandler,
    StdAccountUpdateHandler,
    StdAccountListHandler,
    StdEntitlementListOutput,
    StdAccountListOutput,
    AttributeChangeOp,
} from '@sailpoint/connector-sdk'
import assert from 'assert'
import { Config } from './model/config'
import { ISCClient } from './isc-client'
import {
    AccessRequestType,
    EntitlementDocument,
    EntitlementRefV2025,
    EntitlementV2025,
    IdentityDocument,
    Index,
    JsonPatchOperationV2025,
} from 'sailpoint-api-client'
import { Entitlement } from './model/entitlement'

// Connector must be exported as module property named connector
export const connector = async () => {
    const serializePayload = (payload: unknown): string => {
        try {
            return JSON.stringify(payload)
        } catch (error) {
            return `Unable to serialize payload: ${(error as Error).message}`
        }
    }

    const formatLogMessage = (message: string, payload?: unknown): string =>
        payload === undefined ? message : `${message} :: ${serializePayload(payload)}`

    const logDebug = (message: string, payload?: unknown) => logger.debug(formatLogMessage(message, payload))
    const logInfo = (message: string, payload?: unknown) => logger.info(formatLogMessage(message, payload))
    const logError = (message: string, payload?: unknown) => logger.error(formatLogMessage(message, payload))

    logDebug('Initializing connector')
    const config: Config = await readConfig()
    logDebug('Configuration loaded', { config })

    // Use the vendor SDK, or implement own client as necessary, to initialize a client
    const isc = new ISCClient(config)
    logDebug('ISC client initialized')

    const findSource = async () => {
        const id = config!.spConnectorInstanceId as string
        const allSources = await isc.listSources()
        const source = allSources.find((x) => (x.connectorAttributes as any).spConnectorInstanceId === id)

        assert(source, `Source with spConnectorInstanceId ${id} not found`)

        return source
    }

    const source = await findSource()

    const createAccessRequest = async (identity: string, entitlements: string[], requestType: AccessRequestType) => {
        logDebug('Creating access request', { identity, entitlements, requestType })

        const comment = `Proxy access request for ${entitlements.join(', ')}`
        const sourceEntitlements = await getSourceEntitlements(entitlements)

        let response
        try {
            response = await isc.createAccessRequest(identity, sourceEntitlements, requestType, comment)
        } catch (error) {
            logDebug('First attempt failed, retrying in 1 minute', { error })
            await new Promise((resolve) => setTimeout(resolve, 60000))
            response = await isc.createAccessRequest(identity, sourceEntitlements, requestType, comment)
        }
        logDebug('Access request created successfully', { response })
        return response
    }

    const getSourceEntitlements = async (entitlementValues: string[]): Promise<string[]> => {
        const accountEntitlements = new Set<string>()
        for (const entitlementValue of entitlementValues) {
            const entitlement = await isc.getEntitlementbySource(entitlementValue, source!.id!)
            const sourceEntitlements: string[] = entitlement?.attributes?.ids ?? []
            for (const sourceEntitlement of sourceEntitlements) {
                accountEntitlements.add(sourceEntitlement)
            }
        }
        return Array.from(accountEntitlements)
    }

    const buildEntitlementRef = (ids: string[]): EntitlementRefV2025[] => {
        return ids.map((id) => ({
            id,
            type: 'ENTITLEMENT',
        }))
    }

    const stdTestConnection: StdTestConnectionHandler = async (context, input, res) => {
        logDebug('Testing connection')
        try {
            await isc.getPublicIdentityConfig()
            logDebug('Connection test successful')
            res.send({})
        } catch (error) {
            logError('Connection test failed', { error })
            throw new ConnectorError(error as string)
        }
    }

    const stdAccountList: StdAccountListHandler = async (context, input, res) => {
        const entitlements = await isc.listEntitlements(source!.id)
        const entitlementMap = new Map<string, EntitlementV2025>(entitlements.map((x) => [x.name!, x]))

        const sourceEntitlementIds = new Set<string>(entitlements.map((x) => x.attributes!.ids).flat())

        const identities = (await isc.search('*', Index.Identities, {
            includes: ['id', 'name', 'access.id', 'access.name', 'access.value', 'access.type', 'access.source.id'],
        })) as IdentityDocument[]
        for (const identity of identities) {
            const entitlementsAttribute = new Set<string>()
            const access = (identity.access ?? []) as any[]
            const currentSourceEntitlements = access.filter(
                (x) => x.type === 'ENTITLEMENT' && sourceEntitlementIds.has(x.id!)
            )
            const currentProxyEntitlements = access.filter(
                (x) => x.type === 'ENTITLEMENT' && x.source?.id === source!.id
            )

            for (const entitlement of currentSourceEntitlements) {
                entitlementsAttribute.add(entitlement.name)
            }

            for (const entitlement of currentProxyEntitlements) {
                const entitlementObject = entitlementMap.get(entitlement.name)
                if (entitlementObject && !entitlementsAttribute.has(entitlement.name)) {
                    const ids = entitlementObject.attributes!.ids as string[]
                    if (ids.every((x) => currentSourceEntitlements.includes(x))) {
                        entitlementsAttribute.add(entitlementObject.value!)
                    }
                }
            }

            if (entitlementsAttribute.size > 0) {
                const account: StdAccountListOutput = {
                    identity: identity.name,
                    uuid: identity.name,
                    attributes: {
                        id: identity.name,
                        name: identity.name,
                        entitlements: Array.from(entitlementsAttribute),
                    },
                }

                logDebug('Sending account', { account })
                res.send(account)
            }
        }
        logDebug('Account list operation completed')
    }

    const stdEntitlementList: StdEntitlementListHandler = async (context, input, res) => {
        logDebug('Starting entitlement list operation')
        const entitlementSearch = (await isc.search(config.search, Index.Entitlements)) as EntitlementDocument[]
        const originalSourceId = entitlementSearch[0].source?.id
        logDebug('Found entitlements', { count: entitlementSearch.length })
        const products: Map<string, Entitlement> = new Map()
        const roles: Map<string, Entitlement> = new Map()

        const entitlements: StdEntitlementListOutput[] = []
        for (const e of entitlementSearch) {
            const entitlement = new Entitlement(e)
            logDebug('Processing entitlement', { entitlement })
            const productName = entitlement.attributes.product as string
            let productIds: string[] = []
            let product: Entitlement
            const roleName = entitlement.attributes.role as string
            const roleId = `${productName}-${roleName}`
            let role: Entitlement
            let roleIds: string[] = []

            if (!products.has(productName)) {
                product = Entitlement.buildParent(productName)
                productIds = product.attributes.ids as string[]
                products.set(productName, product)
            } else {
                product = products.get(productName)!
                productIds = product.attributes.ids as string[]
            }
            productIds.push(e.id!)

            if (!roles.has(roleId)) {
                role = Entitlement.buildParent(productName, roleName)
                roleIds = role.attributes.ids as string[]
                roles.set(roleId, role)
            } else {
                role = roles.get(roleId)!
                roleIds = role.attributes.ids as string[]
            }
            roleIds.push(e.id!)

            if (!e.requestable) {
                logDebug('Making entitlement requestable', { entitlementId: e.id })
                await isc.patchEntitlement(e.id, [{ op: 'replace', path: '/requestable', value: true }])
            }

            entitlements.push(entitlement)
        }

        for (const [productName, product] of products) {
            logDebug('Sending product', { productName, product })
            if (config.createAccessProfile) {
                try {
                    const entitlementRefs = buildEntitlementRef(product.attributes.ids as string[])
                    let accessProfile = await isc.getAccessProfileByName(productName)
                    if (accessProfile) {
                        logger.debug(`Updating existing access profile: ${productName}`)
                        const accessProfileUpdate: JsonPatchOperationV2025[] = [
                            {
                                op: 'replace',
                                path: '/entitlements',
                                value: entitlementRefs,
                            },
                            {
                                op: 'replace',
                                path: '/requestable',
                                value: false,
                            },
                        ]
                        accessProfile = await isc.updateAccessProfile(accessProfile.id!, accessProfileUpdate)
                    } else {
                        logger.debug(`Creating new access profile: ${productName}`)
                        accessProfile = await isc.createAccessProfile(
                            productName,
                            source.owner!.id!,
                            originalSourceId!,
                            entitlementRefs,
                            false
                        )
                    }
                    logDebug('Access profile created', { accessProfile })
                } catch (error) {
                    logError('Error creating access profile', { error })
                }
            }
            res.send(product)
        }

        for (const [roleName, role] of roles) {
            logDebug('Sending role', { roleName, role })
            if (config.createAccessProfile) {
                try {
                    const entitlementRefs = buildEntitlementRef(role.attributes.ids as string[])
                    let accessProfile = await isc.getAccessProfileByName(roleName)
                    if (accessProfile) {
                        logger.debug(`Updating existing access profile: ${roleName}`)
                        const accessProfileUpdate: JsonPatchOperationV2025[] = [
                            {
                                op: 'replace',
                                path: '/entitlements',
                                value: entitlementRefs,
                            },
                            {
                                op: 'replace',
                                path: '/requestable',
                                value: false,
                            },
                        ]
                        accessProfile = await isc.updateAccessProfile(accessProfile.id!, accessProfileUpdate)
                    } else {
                        logger.debug(`Creating new access profile: ${roleName}`)
                        accessProfile = await isc.createAccessProfile(
                            roleName,
                            source.owner!.id!,
                            originalSourceId!,
                            entitlementRefs,
                            false
                        )
                    }
                    logDebug('Access profile created', { accessProfile })
                } catch (error) {
                    logError('Error creating access profile', { error })
                }
            }
            res.send(role)
        }

        for (const entitlement of entitlements) {
            logDebug('Sending entitlement', { entitlement })
            res.send(entitlement)
        }
        logDebug('Entitlement list operation completed')
    }

    const stdAccountCreate: StdAccountCreateHandler = async (context, input, res) => {
        logInfo('Starting account creation')
        logInfo('Account creation input', { input })
        const name = input.attributes.name ?? (input.identity as string)
        const entitlements = [input.attributes.entitlements].flat()
        logInfo('Account creation parameters', { name, proxyEntitlements: entitlements })

        const identity = await isc.getIdentityByName(name)

        assert(identity, `Identity ${name} not found`)

        const sourceEntitlements = await getSourceEntitlements(entitlements)

        logDebug('Creating access request for new account')
        const response = await createAccessRequest(identity.id, sourceEntitlements, AccessRequestType.GrantAccess)
        logDebug('Access request created', { response })

        const account: StdAccountListOutput = {
            identity: name,
            uuid: name,
            attributes: {
                id: name,
                name,
                entitlements,
            },
        }
        logDebug('Account created successfully', { account })
        res.send(account)
    }

    const stdAccountUpdate: StdAccountUpdateHandler = async (context, input, res) => {
        logDebug('Starting account update', { input })

        const name = input.identity
        const existingAccount = await isc.getAccountBySource(name, source.id!)
        logDebug('Retrieved existing account', { existingAccount })

        assert(existingAccount, `Account ${name} not found`)

        let entitlementsAdd: string[] = []
        let entitlementsRemove: string[] = []

        if (input.changes) {
            logDebug('Processing account changes', { changes: input.changes })
            for (const change of input.changes) {
                assert(change.op !== 'Set', 'Unsupported operation')
                const values = [change.value].flat()
                logDebug('Processing change operation', { operation: change.op, values })

                const operation =
                    change.op === AttributeChangeOp.Add ? AccessRequestType.GrantAccess : AccessRequestType.RevokeAccess
                logDebug(`${change.op} entitlements`, { entitlements: entitlementsAdd })
                const response = await createAccessRequest(existingAccount.identityId!, values, operation)

                if (operation === AccessRequestType.GrantAccess) {
                    entitlementsAdd = entitlementsAdd.concat(values)
                } else {
                    entitlementsRemove = entitlementsRemove.concat(values)
                }
                logDebug(`${change.op} entitlements successfully`, { response })
            }
        }

        let entitlements = [...existingAccount?.attributes?.entitlements, ...entitlementsAdd].filter(
            (x) => !entitlementsRemove.includes(x)
        )
        entitlements = Array.from(new Set(entitlements))
        logDebug('Final entitlements list', { entitlements })

        const account: StdAccountListOutput = {
            identity: name,
            uuid: name,
            attributes: {
                id: name,
                name,
                entitlements,
            },
        }
        logDebug('Account updated successfully', { account })
        res.send(account)
    }

    logDebug('Creating connector with handlers')
    return createConnector()
        .stdTestConnection(stdTestConnection)
        .stdAccountList(stdAccountList)
        .stdAccountCreate(stdAccountCreate)
        .stdAccountUpdate(stdAccountUpdate)
        .stdEntitlementList(stdEntitlementList)
}
