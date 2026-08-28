import { Router } from 'express';
import { requireOAuthToken } from '../middleware/requireOAuthToken.js';
import { tools, toolManifest } from '../mcpTools.js';

export const mcpRouter = Router();

const SERVER_INFO = { name: 'kall-konnect-mvp', title: 'kall-konnect-mvp', version: '1.0.0' };
const INSTRUCTIONS =
  'Tools for kall-konnect-mvp, a relationship check-in app. Use `who_to_call` to find overdue contacts, ' +
  '`list_contacts` to browse them, `add_contact` to create one, `log_call` to record a conversation, ' +
  'and `list_call_notes` to review past conversations. All tools act as the signed-in user.';

/**
 * A minimal MCP server using the "Streamable HTTP" transport in its simplest
 * form: every request is a single JSON-RPC object, and — since none of our
 * tools need streaming — we always reply with one JSON response rather than
 * opening an SSE stream. This is spec-legal for non-streaming responses and
 * avoids pulling in the full MCP SDK for five simple CRUD-ish tools.
 */
mcpRouter.post('/mcp', requireOAuthToken, async (req, res) => {
  const { jsonrpc, id, method, params } = req.body ?? {};

  // Notifications (no id) get no response body.
  if (id === undefined) return res.status(202).end();

  const reply = (result) => res.json({ jsonrpc: '2.0', id, result });
  const replyError = (code, message) => res.json({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    if (method === 'initialize') {
      return reply({
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    if (method === 'tools/list') {
      return reply({ tools: toolManifest() });
    }

    if (method === 'tools/call') {
      const tool = tools[params?.name];
      if (!tool) return replyError(-32602, `Unknown tool: ${params?.name}`);
      const result = await tool.handler(params?.arguments ?? {}, req.userId);
      return reply(result);
    }

    return replyError(-32601, `Unknown method: ${method}`);
  } catch (err) {
    console.error('MCP tool call failed:', err);
    return replyError(-32000, err.message ?? 'Internal error');
  }
});
