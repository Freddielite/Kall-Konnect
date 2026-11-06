import { ValidationError } from '../lib/validate.js';
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
      const name = params?.name;
      const tool = typeof name === 'string' && Object.hasOwn(tools, name) ? tools[name] : null;
      if (!tool) return replyError(-32602, `Unknown tool: ${name}`);
      const args = params?.arguments ?? {};
      try {
        return reply(await tool.handler(args, req.userId));
      } catch (err) {
        // Bad arguments go back to the model as a tool error it can read
        // and correct, per MCP convention, rather than a protocol error.
        if (err instanceof ValidationError) {
          return reply({ content: [{ type: 'text', text: err.message }], isError: true });
        }
        throw err;
      }
    }

    return replyError(-32601, `Unknown method: ${method}`);
  } catch (err) {
    console.error('MCP tool call failed:', err);
    // Never err.message: for a database error that's schema detail.
    return replyError(-32000, 'Internal error');
  }
});
