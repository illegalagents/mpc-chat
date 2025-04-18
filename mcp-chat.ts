import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  // ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  // ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  // ReadResourceResultSchema,
  // SubscribeRequestSchema,
  // UnsubscribeRequestSchema,
  type Resource,
  type ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToTs, printNode } from "zod-to-ts";

const printZodSchema = (schema: z.ZodTypeAny) => {
  const { node } = zodToTs(schema, "Schema");
  const schemaString = printNode(node);
  return schemaString;
};

export type ChatNotificationMessage = {
  id: string;
  uri: string;
  author: {
    name: string;
    id: string;
  };
  content: string;
  timestamp: string;
};

export function parseChatProtocolUrl(url: string) {
  const protocolMatch = url.match(/^(chat\+[^\:]+):\/\/\/(.*)/);
  if (protocolMatch) {
    const protocol = protocolMatch?.[1]; // chat+discord
    const pathname = protocolMatch?.[2]; // /1234567890/1234567890
    return { protocol, pathname };
  } else {
    return null;
  }
}

export class MCPMessageBus {
  getResources: () => Promise<Resource[] | undefined>;
  readMessages: (uri: string) => Promise<ChatNotificationMessage[] | undefined>;
  writeMessage: (uri: string, message: string) => Promise<string | undefined>;
  resourceTemplate: ResourceTemplate;
  requestHandlers = new Map<
    string,
    (request: z.infer<any>, extra: any) => any
  >();
  server: Server | null = null;

  constructor({
    getResources,
    readMessages,
    writeMessage,
    resourceTemplate,
  }: {
    getResources: () => Promise<Resource[] | undefined>;
    readMessages: (
      uri: string
    ) => Promise<ChatNotificationMessage[] | undefined>;
    writeMessage: (uri: string, message: string) => Promise<string | undefined>;
    resourceTemplate: ResourceTemplate;
  }) {
    this.getResources = getResources;
    this.readMessages = readMessages;
    this.writeMessage = writeMessage;
    this.resourceTemplate = resourceTemplate;
  }
  attach(server: Server) {
    server.setRequestHandler(
      ListToolsRequestSchema,
      async (request: any, extra: any) => {
        const requestHandler = this.requestHandlers.get(
          printZodSchema(ListToolsRequestSchema)
        );
        const originalToolsResponse = requestHandler
          ? await requestHandler(request, extra)
          : { tools: [] };
        const protocols = await this.getProtocols();

        const tools = [];
        for (const protocol of protocols) {
          tools.push({
            name: protocol,
            description: `Send a message on the ${this.resourceTemplate.name} protocol using the resource URI`,
            inputSchema: {
              type: "object",
              properties: {
                uri: {
                  type: "string",
                  description: `Resource URI in the format ${this.resourceTemplate.uriTemplate} -- ${this.resourceTemplate.description}`,
                },
                message: {
                  type: "string",
                  description: "Message content to send",
                },
              },
              required: ["uri", "message"],
            },
          });
        }
        return {
          tools: [...originalToolsResponse.tools, ...tools],
        };
      }
    );
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request: any, extra: any) => {
        const { name, arguments: args } = request.params;

        const protocols = await this.getProtocols();
        if (protocols.includes(name)) {
          const { uri, message } = SendChatMessageSchema.parse(args);

          const summaryText = await this.writeMessage(uri, message);

          return {
            content: [
              {
                type: "text",
                text: summaryText,
              },
            ],
          };
        } else {
          const requestHandler = this.requestHandlers.get(
            printZodSchema(CallToolRequestSchema)
          );
          if (requestHandler) {
            return await requestHandler(request, extra);
          } else {
            return {
              content: [],
            };
          }
        }
      }
    );
    server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: any, extra: any) => {
        const { uri } = request.params;

        const messages = await this.readMessages(uri);
        if (messages) {
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    uri,
                    messages,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          const requestHandler = this.requestHandlers.get(
            printZodSchema(ReadResourceRequestSchema)
          );
          if (requestHandler) {
            return await requestHandler(request, extra);
          } else {
            return {
              contents: [],
            };
          }
        }
      }
    );
    server.setRequestHandler(
      ListResourcesRequestSchema,
      async (request: any, extra: any) => {
        const localResources = (await this.getResources()) ?? [];

        let otherResources = {
          resources: [] as Resource[],
        };
        const requestHandler = this.requestHandlers.get(
          printZodSchema(ListResourcesRequestSchema)
        );
        if (requestHandler) {
          otherResources = await requestHandler(request, extra);
        }

        return {
          resources: [...localResources, ...otherResources.resources],
        };
      }
    );
    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (request: any, extra: any) => {
        const localResourceTemplates = [this.resourceTemplate];

        let otherResourceTemplates = {
          resourceTemplates: [] as ResourceTemplate[],
        };
        const requestHandler = this.requestHandlers.get(
          printZodSchema(ListResourceTemplatesRequestSchema)
        );
        if (requestHandler) {
          otherResourceTemplates = await requestHandler(request, extra);
        }

        return {
          resourceTemplates: [
            ...localResourceTemplates,
            ...otherResourceTemplates.resourceTemplates,
          ],
        };
      }
    );

    // override the default request handler
    server.setRequestHandler = <T extends z.ZodTypeAny>(
      requestSchema: T,
      handler: (request: z.infer<T>, extra: any) => any
    ) => {
      this.requestHandlers.set(printZodSchema(requestSchema), handler);
    };

    this.server = server;
  }

  private async getProtocols() {
    const resources = (await this.getResources()) ?? [];
    const allProtocols = resources.map((resource) => {
      const parsed = parseChatProtocolUrl(resource.uri);
      if (parsed) {
        return parsed.protocol;
      } else {
        throw new Error(`Failed to parse resource URI: ${resource.uri}`);
      }
    });
    const uniqueProtocolsSet = new Set(allProtocols);
    const protocols = Array.from(uniqueProtocolsSet);
    return protocols;
  }

  private isServerTransportStarted() {
    return !!(this.server && (this.server.transport as any)?._started);
  }

  /**
   * Add a resource URI to the subscriptions list
   * @param uri Resource URI to subscribe to
   * @returns boolean indicating if the subscription was added (true) or already existed (false)
   */
  public updateResourceList() {
    if (this.isServerTransportStarted()) {
      this.server!.sendResourceListChanged();
    }
  }

  async updateResource(uri: string, id: string) {
    // send resource updated notification to MCP clients
    (async () => {
      try {
        await this.server!.sendResourceUpdated({
          uri,
        });
      } catch (error) {
        console.error(
          `Failed to send channel resource update notification for ${uri}:`,
          error
        );
      }
    });

    // Send optimistic resource update notification to MCP clientsagent
    (async () => {
      const messages = await this.readMessages(uri);
      const message = messages?.find((m) => m.id === id) ?? null;

      console.warn('sending notification 1');
      const msg = {
        method: "notifications/resources/content_updated",
        params: {
          content: message,
        },
      };
      console.warn('sending notification 2', msg);
      this.server!.notification(msg);
    })();
  }
}

export const SendChatMessageSchema = z.object({
  uri: z.string().describe("Resource URI in the format of the protocol"),
  message: z.string().describe("Message to send"),
});
