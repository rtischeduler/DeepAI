# DeepAI

Reverse-engineering workspace for `https://deepai.org/chat`, with requests sent through Singuloxy (libcurl + wisp) the same way `rtischeduler/WebBlox` does it.

## index.html

A single page that proxies the real DeepAI chat through Singuloxy and shows only the chat. It uses the same proxy layer as `rtischeduler/SingularityNOW` (wisp list sync, probing, verification, automatic switching and retry).

- The page `https://deepai.org/chat` is fetched through the proxy, its own scripts are inlined, and it runs inside a frame on this page.
- Every request the page makes (chat, models, login, attachment upload and download, images) goes through Singuloxy with a cookie jar kept in `localStorage`. Request bodies are encoded to bytes in the browser first, so attachment uploads reach DeepAI as a finished multipart body.
- The site header, footer, banners and promos are hidden and a dark restyle is applied on top. Ads and analytics scripts are blocked.
- Sign-in is available from the chat's own sign-in prompt, which appears when the free limit is reached.
- If the proxy drops, a "Switch proxy" button appears.

## Pulling the site

Run the `pull-deepai` workflow (Actions tab, Run workflow). Inputs: start page (default `https://deepai.org/chat`), output folder (default `Site`), extra hosts to follow. It saves every text file it can reach into `Site/files/<host>/...` and writes `Site/index.tsv` (status per URL), `Site/urls.txt` and `Site/endpoints.tsv` (API-looking strings found in scripts), then commits the result.

## Modules

- `src/proxy.mjs`: loads Singuloxy from jsDelivr, picks a working wisp server, returns `{ fetch, wisp }`.
- `src/wisps.mjs`, `src/health.mjs`: wisp discovery, probing and bad-server tracking (ported from WebBlox).
- `src/client.mjs`: DeepAI client built from the pulled page.

## Client

```js
import { createProxy } from "./src/proxy.mjs";
import { createClient } from "./src/client.mjs";

const proxy = await createProxy({ say: console.log });
const deepai = createClient({ fetch: proxy.fetch });

await deepai.login("me@example.com", "password");
const models = await deepai.listModels();
const file = await deepai.uploadAttachment(new File(["hello"], "note.txt", { type: "text/plain" }));
const text = await deepai.ask({
  model: models[0].id,
  messages: [{ role: "user", content: "Summarise the attachment" }],
  attachments: [file],
});
```

`deepai.chat(options)` is the streaming form and yields `{ type: "text", value }` chunks. Errors are `DeepAIError` with `status` and `code` (for example `anonymous try it exceeded`).

Endpoints used: `/get_user_login_type`, `/daily-time-sync/login|logout|user/`, `/get_usage_summary`, `/chat_attachments/upload|get`, `/get_chat_session`, `/get_my_chat_sessions_and_convert_anonymous_sessions`, `/check_chat_task_status` and `/hacking_is_a_serious_crime` (the chat request itself), all on `https://api.deepai.org`.

## Attachments

Handled like the site (`uploadChatAttachment` in the pulled chat page): `uploadAttachment` posts a multipart `file` field to `/chat_attachments/upload` with the session cookies and no `api-key` header, and returns `{ uuid, ... }`. Each chat request then carries `attachment_uuids` for every attachment in the conversation (taken from the `attachment_uuids` / `attachments` of the messages plus the `attachments` option), not just the new ones. Unit test: `node --test test/`.
