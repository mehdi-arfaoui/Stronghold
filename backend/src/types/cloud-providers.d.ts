declare module "@azure/identity" {
  export class ClientSecretCredential {
    constructor(tenantId: string, clientId: string, clientSecret: string);
    getToken(...args: any[]): Promise<any>;
  }
}

declare module "@azure/arm-containerservice" {
  export class ContainerServiceClient {
    constructor(credential: unknown, subscriptionId: string);
    managedClusters: {
      list(): AsyncIterable<any>;
    };
  }
}

declare module "@azure/arm-storage" {
  export class StorageManagementClient {
    constructor(credential: unknown, subscriptionId: string);
    storageAccounts: {
      list(): AsyncIterable<any>;
    };
  }
}

declare module "@google-cloud/sql" {
  export class SqlInstancesServiceClient {
    constructor(options?: unknown);
    list(request: { project: string }): Promise<[{
      items?: any[];
    }]>;
  }
}
