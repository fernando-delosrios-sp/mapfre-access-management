import {
    AccessProfilesV2025Api,
    AccessProfilesV2025ApiCreateAccessProfileRequest,
    AccessProfilesV2025ApiListAccessProfilesRequest,
    AccessProfilesV2025ApiPatchAccessProfileRequest,
    AccessProfileV2025,
    AccessRequestItem,
    AccessRequestItemTypeV3,
    AccessRequestResponse,
    AccessRequestsApi,
    AccessRequestsApiCreateAccessRequestRequest,
    AccessRequestType,
    Account,
    AccountsApi,
    AccountsApiListAccountsRequest,
    Configuration,
    ConfigurationParameters,
    EntitlementRefV2025,
    EntitlementsV2025Api,
    EntitlementsV2025ApiGetEntitlementRequest,
    EntitlementsV2025ApiListEntitlementsRequest,
    EntitlementsV2025ApiPatchEntitlementRequest,
    EntitlementV2025,
    IdentityDocument,
    Index,
    JsonPatchOperationV2025,
    Paginator,
    PublicIdentitiesConfigApi,
    PublicIdentityConfig,
    QueryResultFilter,
    RequestabilityV2025,
    Schema,
    Search,
    SearchApi,
    SearchDocument,
    SourcesApi,
    SourcesApiCreateSourceSchemaRequest,
} from 'sailpoint-api-client'
import { TOKEN_URL_PATH } from './data/constants'
import { Config } from './model/config'

export class ISCClient {
    private config: Configuration

    constructor(config: Config) {
        const conf: ConfigurationParameters = {
            baseurl: config.baseurl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            tokenUrl: new URL(config.baseurl).origin + TOKEN_URL_PATH,
        }
        this.config = new Configuration(conf)
        this.config.experimental = true
    }

    async getPublicIdentityConfig(): Promise<PublicIdentityConfig> {
        const api = new PublicIdentitiesConfigApi(this.config)

        const response = await api.getPublicIdentityConfig()

        return response.data
    }

    async listSources() {
        const api = new SourcesApi(this.config)

        const response = await Paginator.paginate(api, api.listSources)

        return response.data
    }

    async listSourceSchemas(sourceId: string): Promise<Schema[]> {
        const api = new SourcesApi(this.config)

        const response = await api.getSourceSchemas({ sourceId })

        return response.data
    }

    async createSchema(schema: Schema, sourceId: string): Promise<Schema> {
        const api = new SourcesApi(this.config)

        const requestParameters: SourcesApiCreateSourceSchemaRequest = {
            schema,
            sourceId,
        }

        const response = await api.createSourceSchema(requestParameters)

        return response.data
    }

    async search(query: string, index: Index, queryResultFilter?: QueryResultFilter): Promise<SearchDocument[]> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: [index],
            query: {
                query,
            },
            sort: ['id'],
            includeNested: true,
            queryResultFilter,
        }

        const response = await Paginator.paginateSearchApi(api, search)
        return response.data as SearchDocument[]
    }

    async getEntitlementbySource(value: string, sourceId: string): Promise<EntitlementV2025 | undefined> {
        const api = new EntitlementsV2025Api(this.config)
        const filters = `source.id eq "${sourceId}" and value eq "${value}"`
        const requestParameters: EntitlementsV2025ApiListEntitlementsRequest = { filters }
        const response = await api.listEntitlements(requestParameters)
        return response.data[0]
    }

    async listEntitlements(sourceId?: string): Promise<EntitlementV2025[]> {
        const api = new EntitlementsV2025Api(this.config)
        const filters = sourceId ? `source.id eq "${sourceId}"` : undefined
        const requestParameters: EntitlementsV2025ApiListEntitlementsRequest = { filters }
        const response = await api.listEntitlements(requestParameters)
        return response.data
    }

    async getIdentity(id: string): Promise<IdentityDocument | undefined> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: ['identities'],
            query: {
                query: `id:${id}`,
            },
            includeNested: true,
        }

        const response = await api.searchPost({ search })

        if (response.data.length > 0) {
            return response.data[0] as IdentityDocument
        } else {
            return undefined
        }
    }

    async getIdentityByUid(name: string): Promise<IdentityDocument | undefined> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: ['identities'],
            query: {
                query: `attributes.uid.exact:${name}`,
            },
            includeNested: true,
        }

        const response = await api.searchPost({ search })

        if (response.data.length > 0) {
            return response.data[0] as IdentityDocument
        } else {
            return undefined
        }
    }

    async getIdentityByName(name: string): Promise<IdentityDocument | undefined> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: ['identities'],
            query: {
                query: `name.exact:${name}`,
            },
            includeNested: true,
        }

        const response = await api.searchPost({ search })

        if (response.data.length > 0) {
            return response.data[0] as IdentityDocument
        } else {
            return undefined
        }
    }

    async getAccountBySource(nativeIdentity: string, sourceId: string): Promise<Account | undefined> {
        const api = new AccountsApi(this.config)

        const requestParameters: AccountsApiListAccountsRequest = {
            filters: `nativeIdentity eq "${nativeIdentity}" and sourceId eq "${sourceId}"`,
        }

        const response = await api.listAccounts(requestParameters)

        return response.data[0]
    }

    async getAccountByFilter(filters: string): Promise<Account | undefined> {
        const api = new AccountsApi(this.config)

        const requestParameters: AccountsApiListAccountsRequest = {
            filters,
        }

        const response = await api.listAccounts(requestParameters)

        return response.data[0]
    }

    async createAccessRequest(
        identity: string,
        entitlements: string[],
        requestType: AccessRequestType,
        comment: string
    ): Promise<AccessRequestResponse> {
        const api = new AccessRequestsApi(this.config)

        const requestedItems: AccessRequestItem[] = entitlements.map((x) => ({
            id: x,
            type: AccessRequestItemTypeV3.Entitlement,
            comment,
        }))

        const requestParameters: AccessRequestsApiCreateAccessRequestRequest = {
            accessRequest: {
                requestedFor: [identity],
                requestType,
                requestedItems,
            },
        }

        const response = await api.createAccessRequest(requestParameters)

        return response.data
    }

    async getEntitlement(id: string): Promise<EntitlementV2025> {
        const api = new EntitlementsV2025Api(this.config)

        const requestParameters: EntitlementsV2025ApiGetEntitlementRequest = {
            id,
        }

        const response = await api.getEntitlement(requestParameters)

        return response.data
    }

    async patchEntitlement(id: string, patch: JsonPatchOperationV2025[]): Promise<EntitlementV2025> {
        const api = new EntitlementsV2025Api(this.config)

        const requestParameters: EntitlementsV2025ApiPatchEntitlementRequest = {
            id,
            jsonPatchOperationV2025: patch,
        }

        const response = await api.patchEntitlement(requestParameters)

        return response.data
    }

    async getAccessProfileByName(name: string): Promise<AccessProfileV2025 | undefined> {
        const api = new AccessProfilesV2025Api(this.config)
        const filters = `name eq "${name}"`
        const requestParameters: AccessProfilesV2025ApiListAccessProfilesRequest = {
            filters,
        }
        const response = await api.listAccessProfiles(requestParameters)
        return response.data[0] ? response.data[0] : undefined
    }

    async createAccessProfile(
        name: string,
        ownerId: string,
        sourceId: string,
        entitlements: EntitlementRefV2025[],
        requestable: boolean = false,
        accessRequestConfig?: RequestabilityV2025
    ): Promise<AccessProfileV2025> {
        const api = new AccessProfilesV2025Api(this.config)
        const requestParameters: AccessProfilesV2025ApiCreateAccessProfileRequest = {
            accessProfileV2025: {
                name,
                description: name,
                owner: {
                    id: ownerId,
                    type: 'IDENTITY',
                },
                source: {
                    id: sourceId,
                },
                enabled: true,
                entitlements,
                requestable,
            },
        }
        if (accessRequestConfig) requestParameters.accessProfileV2025.accessRequestConfig = accessRequestConfig
        const response = await api.createAccessProfile(requestParameters)
        return response.data
    }

    async updateAccessProfile(
        id: string,
        jsonPatchOperationV2025: JsonPatchOperationV2025[]
    ): Promise<AccessProfileV2025> {
        const api = new AccessProfilesV2025Api(this.config)
        const requestParameters: AccessProfilesV2025ApiPatchAccessProfileRequest = {
            id,
            jsonPatchOperationV2025,
        }
        const response = await api.patchAccessProfile(requestParameters)
        return response.data
    }
}
