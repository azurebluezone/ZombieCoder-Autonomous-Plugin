# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  464f54571695fe723484cf55f0b9be307f21e400a96114634889d34a92ebf1a9  ║
║  files 63 · bytes 652381 · base aa8524a · dirty                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-10-29T18:16:20.555Z` |
| Base commit | `aa8524a` |
| Branch | `main` |
| Code tree | `dirty` |
| Files | 63 |
| Bytes | 652381 |
| Root SHA-256 | `464f54571695fe723484cf55f0b9be307f21e400a96114634889d34a92ebf1a9` |

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
| `docs/skills/evidence-before-confidence.md` | 3140 | `6f05dd0fc50a97fb8d0eaf77be0f68aee5ee4760847e98a7d3ca3ffb51fe21f7` |
| `docs/skills/fastapi.md` | 1655 | `336760d1a90ba33630224332e9da615b214d3ec627095be9ced772a4fbfb3d34` |
| `docs/skills/first-principles.md` | 1752 | `a6081c550298eb25bbb9d887be98e642a7a4f239ece4b9c8b3cec9865297db3a` |
| `docs/skills/laravel.md` | 1630 | `f35dc9c1bdf4d6217993761bbc1db7beee164dba54e17e4e03ade68b3361c33a` |
| `docs/skills/next.md` | 1669 | `afdf6e2a125f8f9db4357c2d11375dd76f2d3b6d75fe3cf21550c105d6b6d254` |
| `docs/skills/node.md` | 1392 | `44a57ebd465774ec2dba3a736e27c24b4e0dd8370ee5a3ada1a642d5a3301f27` |
| `docs/skills/python-regex.md` | 3759 | `c3afda66297c80485974f66c4212eec935bfccd4431c75c6c6f2210e1406aa95` |
| `docs/skills/python.md` | 1435 | `1fbd7bf69b3ee47b25c0ce08222989be4f2c74ce008f3702b7f913e584cf3b86` |
| `docs/skills/resource-optimization.md` | 1624 | `4180017cb251d46c33afae2b19b44d83ce7f52f6b315b3d0d5e0bd2bb182500e` |
| `docs/skills/scrape-verify.md` | 3098 | `2234c0e92c4ee379cf1268d6f2f62fbf12a1443f73f30f0d36a9f1b41671ef8d` |
| `docs/skills/server.md` | 1685 | `0149a648a6e8b4d8104097986e6796ceb224433707f5e73c281de5e7577eb4e3` |
| `docs/skills/uiux-delivery.md` | 3952 | `c2a66f4f4f3edbee5135b6e4b05ef82165f35baf1f9a7138c0d0f0d268394e15` |
| `docs/skills/web-delivery.md` | 4247 | `61ce13fc7897d4cb1a7bd59cfaa058ef6d94d6d7e7cb34295b179bc7e72cf0db` |
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
| `src/plugin.ts` | 61316 | `94da79cd67a37c350305f9de54b13a184336f2d652f6208a81f8b1c2d97d2e05` |
| `src/roster.ts` | 32133 | `cd7f5b18baf688206f8578e4e2ac8dd97bf12c97e803bed36c1855ced6c7beb5` |
| `src/runtime.ts` | 15970 | `dccfccb3906942d0bd4ac526e0958e3dd5cb6d57007cb58c47a20678ae7c7bae` |
| `src/zombie/circuitBreaker.ts` | 7498 | `ef7bc1023a1740d7284fabe9bfa0af7b65e5539d8f76fbdf03c17a2101ce4bd1` |
| `src/zombie/context.ts` | 10647 | `046286925e4f5a3cd669873672ab291fd8f4d6a8658fb484f0e848433d38e0f8` |
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
| `src/zombie/responseGate.ts` | 33671 | `e279e70d3ea5b164ee1c6feee880187d6657c7904fe13c932ceb0aa71260c6a2` |
| `src/zombie/scan.ts` | 7562 | `9a9b657954f86a7f758a0d1fe17523a9d4c8496803c1e72017c3a7ce88116ade` |
| `src/zombie/server.ts` | 35099 | `03089db566591e8cc3dddada60cc7f87bc64b0608109fbe8e6722bd8a41ad0f9` |
| `src/zombie/skillCatalog.ts` | 18749 | `653cd28c70d3f4196859a2f340979840bcbeaabb131aa3ae45c7c8e7f7093a6c` |
| `src/zombie/skills.ts` | 5284 | `b8bc230b09d593dd2f6775f5c81a7b292e205ac2fd1e2b7cb43b78ddbe4c81d4` |
| `src/zombie/ssot.ts` | 6978 | `8a6086ac0c5a410895c5370485d71d799906e1c52cca6f9e46ca33865f67ea6f` |
| `src/zombie/syllabus.ts` | 7542 | `b564b2cb1e02c1e45f222b40cd39f2bf4d2b52a5fe01b7ff4b543d518a0f29ac` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/circuitBreaker.test.ts` | 3676 | `08d6ece5d464358a6fe2837bbf7b2b091770fd7c14fa0e29a9f25fe5180922fc` |
| `test/context.test.ts` | 28054 | `18edcdccfb82c5dc16dbc675064291d94009d214e3cbb405646affb5388bb297` |
| `test/install.test.ts` | 21970 | `74f1c5c9d8b00c9a991427a960dd2c46849aac789cbb6d9d2ae47411e1566b30` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 3898 | `7a7b09e925f56524eeb14a380c318efd921db097065e1766225745a1b7ee4db5` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/memory.test.ts` | 5971 | `7be693ccf8cba4111b8f4a0a7d70d13f83934b20a0c085a9bb44eafd7315c7b8` |
| `test/models.test.ts` | 12312 | `33b913d0cb4fb196d540c6b317f46c8618bcdb63d3e10225fb0be545d46102ba` |
| `test/modes.test.ts` | 4666 | `35f0830f7126a91027398b1fed04b73c3a77d482bf488987f041d6837094d6c2` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 44439 | `0088623408baf56f621d6e3cc974bd65e1c5b98f92d6ecc3d54ad02830a46c91` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/skillCatalog.test.ts` | 6533 | `c7743d5c6a0d39bb57bd3ebf9aa23004efae4ca5bfda903bf17033228ed487ad` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
