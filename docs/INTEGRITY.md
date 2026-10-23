# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  ff64f0374a61b97a42e52768b8377e4a22aa5457732d24f5b4db103bc3751cf0  ║
║  files 59 · bytes 601124 · base 1510ca2 · dirty                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-10-23T02:31:07.827Z` |
| Base commit | `1510ca2` |
| Branch | `snapshot/current-state-20261023` |
| Code tree | `dirty` |
| Files | 59 |
| Bytes | 601124 |
| Root SHA-256 | `ff64f0374a61b97a42e52768b8377e4a22aa5457732d24f5b4db103bc3751cf0` |

## Scope

- `src`
- `bin`
- `scripts`
- `test`
- `docs/skills`
- `package.json`
- `LICENSE`

## Verify

```bash
npm run integrity:check
```

`--check` কোনো file লেখে না; mismatch হলে exit code `1` দেয়।

## Files

| Path | Bytes | SHA-256 |
|---|---:|---|
| `bin/install.mjs` | 56629 | `e1f97357d4b86d9c71f50c22dadb3d173a35845962c9193c23af2ad74f457af7` |
| `bin/quick-install.mjs` | 5685 | `fa97c3318d7630421e4f596044aa61da60c0f0d8b7533035f1013f462cedc078` |
| `docs/skills/cpanel.md` | 1867 | `f056fa581f9a0fa268556d8769fc2c5389a864fbd552e90b1692efde0c003537` |
| `docs/skills/evidence-before-confidence.md` | 1825 | `087195382d983591c2d2d5619ac0b36ee695ba3a0d9ef25bb5c7777911b034c3` |
| `docs/skills/fastapi.md` | 1655 | `336760d1a90ba33630224332e9da615b214d3ec627095be9ced772a4fbfb3d34` |
| `docs/skills/first-principles.md` | 1700 | `4e63d8eeb8ae30b39427fc6335c38891cffded74fc866246faf2224127fd5bef` |
| `docs/skills/laravel.md` | 1630 | `f35dc9c1bdf4d6217993761bbc1db7beee164dba54e17e4e03ade68b3361c33a` |
| `docs/skills/next.md` | 1669 | `afdf6e2a125f8f9db4357c2d11375dd76f2d3b6d75fe3cf21550c105d6b6d254` |
| `docs/skills/node.md` | 1392 | `44a57ebd465774ec2dba3a736e27c24b4e0dd8370ee5a3ada1a642d5a3301f27` |
| `docs/skills/python.md` | 1435 | `1fbd7bf69b3ee47b25c0ce08222989be4f2c74ce008f3702b7f913e584cf3b86` |
| `docs/skills/resource-optimization.md` | 1624 | `4180017cb251d46c33afae2b19b44d83ce7f52f6b315b3d0d5e0bd2bb182500e` |
| `docs/skills/server.md` | 1685 | `0149a648a6e8b4d8104097986e6796ceb224433707f5e73c281de5e7577eb4e3` |
| `LICENSE` | 1961 | `d06b8b22307bf25fa4e3dba778ad2ccc1350c2e5cd1b5e6ed40c2de25b6cd95a` |
| `package.json` | 1303 | `b54d5b1854c40cb0ab7b325a912d5906334b7da7b6fb8dc3ff4ec552e23ba848` |
| `scripts/configure.mjs` | 14570 | `53c62929b01c0cc5bddc1a21935e88790c6f67a8d5b7989711b894a6da0faf18` |
| `scripts/integrity.mjs` | 10134 | `2a3485b44f9e85be5493252f07c815386c8e9c96013ff3f434f368fd44f1b867` |
| `scripts/lsp-probe.mjs` | 6818 | `59f9dca359bcdc7dac673964beef7fc7d40e6e829e603ce3cd4e8bd8ecf3d2ae` |
| `scripts/setup.mjs` | 12807 | `f991bf440bbcd38819a40978e201817004e5574c4c45ed4f4921fa9ec0353d5f` |
| `src/agents.ts` | 13479 | `0e9fc2b22e375579fb2e77d8772717aec58cf31bd0bad91795cbd0dd4b46574e` |
| `src/ethics.ts` | 10670 | `db6c18984a5357106de459cd701c613c293971be372785594d57e83eeea7c921` |
| `src/generate.ts` | 5739 | `e7f4ac46cf1eaa29920a3431f4be39e231d3103b162d36dd1fb9d3384fb87ad8` |
| `src/identity.ts` | 8055 | `b22066b981cbb755e896eb7a717eb3e7d3162102205bb3e3166ecd939f195ba4` |
| `src/plugin.ts` | 59392 | `b8d3e79a534517dca401ce2a7c9a1190472e61376e649edcc6037d8c09d73781` |
| `src/roster.ts` | 29647 | `b484cb0b084d756b5bb4a06eaf810fe48339f138681d454bc7968645f3f39da0` |
| `src/runtime.ts` | 15970 | `dccfccb3906942d0bd4ac526e0958e3dd5cb6d57007cb58c47a20678ae7c7bae` |
| `src/zombie/circuitBreaker.ts` | 7498 | `ef7bc1023a1740d7284fabe9bfa0af7b65e5539d8f76fbdf03c17a2101ce4bd1` |
| `src/zombie/context.ts` | 10127 | `c782fe990c9edc8b9e6c5cfbcf4d8add8817040b4fddc727d74f59b844a69eba` |
| `src/zombie/defaults.ts` | 2668 | `bdd1da278ec370626c5b0f45622f1989ace2d5c27efde5f040fbac766e142a87` |
| `src/zombie/io.ts` | 5006 | `89b3f44e558f7b7d07735a9ac0a1fc3f610794c2ac10f50d3e7cd19b379d5dad` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/lspConfig.ts` | 6270 | `66d6ae3e695eca85a21563f9f42d3538005f3a753496e058ea79cd6be823e59a` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/memory.ts` | 11261 | `591eab6db230579bc1511176869992fce01f062b3c8bb419387272d1bbf8d6a2` |
| `src/zombie/models.ts` | 17490 | `abc7aec6ebd3d3f1f3b1abec32cfa8d04c34c6f3f451afd7c5917cac09ad1298` |
| `src/zombie/modes.ts` | 11052 | `b23eb59b3c27ffc147f702ba99cfc01e28eedb478ceef45c81cacd9ae4f8efc5` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 3675 | `11ac1335d655df0c16b877ffacd5e54fc4493b5a2276d1ad1d775f4bf413fa0a` |
| `src/zombie/responseGate.ts` | 26146 | `26e679d99428e065b361404aa2a4b20e6fe32621f785a00aa9490f2e21a2003c` |
| `src/zombie/scan.ts` | 7562 | `9a9b657954f86a7f758a0d1fe17523a9d4c8496803c1e72017c3a7ce88116ade` |
| `src/zombie/server.ts` | 24517 | `025912e18d4207e3da8031ef112da1380b46fb2ffc58c84c2810d3e88400c05e` |
| `src/zombie/skillCatalog.ts` | 16791 | `c82d02f757c9261ba66f200df31ddf2f8685d9851e2a2f8962e6d0d1d53a8ae1` |
| `src/zombie/skills.ts` | 5284 | `b8bc230b09d593dd2f6775f5c81a7b292e205ac2fd1e2b7cb43b78ddbe4c81d4` |
| `src/zombie/ssot.ts` | 6978 | `8a6086ac0c5a410895c5370485d71d799906e1c52cca6f9e46ca33865f67ea6f` |
| `src/zombie/syllabus.ts` | 7542 | `b564b2cb1e02c1e45f222b40cd39f2bf4d2b52a5fe01b7ff4b543d518a0f29ac` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/circuitBreaker.test.ts` | 3676 | `08d6ece5d464358a6fe2837bbf7b2b091770fd7c14fa0e29a9f25fe5180922fc` |
| `test/context.test.ts` | 23418 | `db86edd28d162f8397985e2862600c23b29c241d4f48f8a9f05cfb048bb442dd` |
| `test/install.test.ts` | 21970 | `74f1c5c9d8b00c9a991427a960dd2c46849aac789cbb6d9d2ae47411e1566b30` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 3898 | `7a7b09e925f56524eeb14a380c318efd921db097065e1766225745a1b7ee4db5` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/memory.test.ts` | 5971 | `7be693ccf8cba4111b8f4a0a7d70d13f83934b20a0c085a9bb44eafd7315c7b8` |
| `test/models.test.ts` | 12312 | `33b913d0cb4fb196d540c6b317f46c8618bcdb63d3e10225fb0be545d46102ba` |
| `test/modes.test.ts` | 4666 | `35f0830f7126a91027398b1fed04b73c3a77d482bf488987f041d6837094d6c2` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 40660 | `1ad20565f8ac36ca62247a8b99a8b337eb0dd4b7e542c6cac72e67f44a8504bb` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/skillCatalog.test.ts` | 5109 | `2ec6a36107c0fff63f499e439e1ad4ae2c2a53bfedaf6128ed7b57a4de9e1ba3` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
