import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface DynamoDbClientOptions {
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Factory do cliente DynamoDB. Todo o AWS SDK fica confinado aos adapters
 * (ADR-001, regra 3). `removeUndefinedValues: true` garante que campos
 * opcionais ausentes não sejam persistidos (compatível com
 * exactOptionalPropertyTypes).
 */
export function createDynamoDbClient(options: DynamoDbClientOptions): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.accessKeyId && options.secretAccessKey
      ? { credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
    unmarshallOptions: {},
  });
}