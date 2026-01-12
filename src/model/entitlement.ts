import { Attributes, Permission, StdEntitlementListOutput } from '@sailpoint/connector-sdk'
import { EntitlementDocument } from 'sailpoint-api-client'

export const parseName = (name?: string) => {
    const parts = name?.split('-').filter(Boolean) ?? []
    const role = parts.pop() ?? ''
    const environment = parts.pop() ?? ''
    const product = parts.pop() ?? ''

    return { product, environment, role }
}

export class Entitlement implements StdEntitlementListOutput {
    identity: string
    uuid: string
    type: string = 'entitlement'
    deleted?: boolean | undefined
    attributes: Attributes
    permissions?: Permission[] | undefined

    constructor(entitlementDocument: EntitlementDocument) {
        const { product, environment, role } = parseName(entitlementDocument.name)
        const parent = `${product}-${role}`
        this.attributes = {
            id: entitlementDocument.name,
            name: entitlementDocument.name,
            description: `Proxy entitlement for ${environment} environment`,
            product,
            environment,
            role,
            parent,
            ids: [entitlementDocument.id],
        }
        this.identity = entitlementDocument.name
        this.uuid = entitlementDocument.name
    }

    static buildParent(product: string, role?: string): Entitlement {
        const name = role ? `${product}-${role}` : product
        const description = role ? `Proxy entitlement for ${role} role` : `Proxy entitlement for ${product} product`
        const entitlement: Entitlement = {
            attributes: {
                id: name,
                name,
                description,
                product,
                role: role ?? '',
                ids: [],
            },
            type: 'entitlement',
            identity: name,
            uuid: name,
        }
        if (role) {
            entitlement.attributes.parent = product
        }
        return entitlement
    }
}
