import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// 1. Initialisation
const server = new Server({ name: "ping-server", version: "1.0.0" }, { capabilities: { tools: {} } });

// 2. Tool declaration (The manual for the AI)
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ 
    name: "system_ping", 
    description: "Returns 'Pong' with the server's exact time to check the connection.", 
    inputSchema: { type: "object", properties: {} } 
  }]
}));

// 3. Tool execution
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "system_ping") {
    return { content: [{ type: "text", text: `Pong! The server time is ${new Date().toLocaleTimeString()}` }] };
  }
  throw new Error("Unknown tool");
});

// 4. Start on stdio
const transport = new StdioServerTransport();
await server.connect(transport);