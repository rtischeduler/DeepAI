# DeepAI

Reverse-engineering workspace for `https://deepai.org/chat`, with requests sent through Singuloxy (libcurl + wisp) the same way `rtischeduler/WebBlox` does it.

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
