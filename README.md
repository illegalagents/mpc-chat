# MCP-Chat SDK

MCP-Chat is a lightweight SDK that implements chat functionality on top of the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). It allows you to create bidirectional chat communication between MCP server and client applications with minimal configuration.

## Overview

MCP-Chat extends the Model Context Protocol by:

1. Providing a standardized interface for chat message exchange
2. Implementing resource-based chat thread management
3. Supporting real-time notifications for new messages
4. Enabling cross-protocol chat functionality with URI pattern `chat+protocol:///path/to/thread`

## Getting Started

```bash
npm install mcp-chat
```

## Usage

MCP-Chat is designed to be simple to implement. You only need to provide a few accessors and attach it to your MCP Server instance:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { MCPMessageBus, ChatNotificationMessage } from "mcp-chat";

// Create your MCP Server
const server = new Server(
  {
    name: "my-chat-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
    instructions: "This is a chat server that supports MCP-Chat protocol",
  }
);

// Create your message bus instance
const messageBus = new MCPMessageBus({
  // Define your resource template for chat threads
  resourceTemplate: {
    uriTemplate: `chat+mycustom:///([^\\/]+)/([^\\/]+)`,
    name: "My Custom Chat",
    description: "Chat resources for my custom protocol",
  },
  
  // Provide an accessor to get all chat resources
  getResources: async () => {
    // Return an array of Resources matching the chat+mycustom:/// pattern
    return [
      {
        uri: "chat+mycustom:///thread1/general",
        name: "General Chat",
        description: "General chat thread",
      },
      // Add more resources as needed
    ];
  },
  
  // Provide an accessor to read messages from a given URI
  readMessages: async (uri: string) => {
    // Parse the URI and return messages for that thread
    // Return array of ChatNotificationMessage objects
    return [
      {
        id: "msg1",
        uri: uri,
        author: {
          name: "User1",
          id: "user1",
        },
        content: "Hello world!",
        timestamp: new Date().toISOString(),
      },
      // Add more messages as needed
    ];
  },
  
  // Provide an accessor to write messages to a given URI
  writeMessage: async (uri: string, message: string) => {
    // Implement your message writing logic
    // Return a confirmation string or undefined
    return "Message sent successfully";
  },
});

// Attach the message bus to your MCP server
messageBus.attach(server);

// When a new message arrives, notify subscribed clients
async function onNewMessage(uri: string) {
  await messageBus.updateResource(uri);
}
```

## Message Format

MCP-Chat uses a standardized message format:

```typescript
export type ChatNotificationMessage = {
  id: string;         // Unique message ID
  uri: string;        // Resource URI where the message belongs
  author: {
    name: string;     // Display name of the author
    id: string;       // Unique ID of the author
  };
  content: string;    // Message content
  timestamp: string;  // ISO timestamp of when the message was sent
};
```

## Resource URIs

Chat resources use a specialized URI format:

```
chat+protocol:///thread/path/goes/here
```

Where:
- `chat+protocol` identifies the chat protocol (e.g., `chat+discord`, `chat+slack`, etc.)
- **IMPORTANT**: All MCP-Chat URIs MUST begin with the `chat+` prefix to be recognized by the SDK
- The path component after `///` identifies the thread or channel

## MCP Client Interactions

Any MCP client that supports the MCP-Chat protocol can:

1. Discover chat resources via the standard MCP resources mechanism
2. Read chat messages by accessing the resource URI
3. Send messages using the protocol-specific tool exposed automatically
4. Subscribe to real-time updates for chat resources

## Subscription and Notifications

To receive real-time updates, clients can:

1. Subscribe to a resource URI using the standard MCP `subscribe` request:

```json
{
  "method": "subscribe",
  "params": {
    "uri": "chat+protocol:///thread/path"
  }
}
```

2. When new messages arrive, call the `updateResource` method:

```typescript
// Notify clients when a new message is received
await messageBus.updateResource("chat+protocol:///thread/path");
```

This will send a resource update notification to all subscribed clients, so they can fetch the updated messages.

## Real-world Example

The `discord-mcp-server` package is an example of MCP-Chat in action. It:

1. Creates a Discord bot that listens for messages
2. Exposes Discord channels as chat resources with URIs like `chat+discord:///serverId/channelId`
3. Allows reading message history from these resources
4. Provides a `chat+discord` tool to send messages back to the channel
5. Notifies clients when new messages arrive on subscribed channels

## License

ISC