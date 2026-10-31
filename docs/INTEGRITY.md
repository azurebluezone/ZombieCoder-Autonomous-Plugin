# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  8050e5f0f3dbc6c157e20d67f4aaae800ef8f6c74a38035a6558931bc192ec2f  ║
║  files 79 · bytes 764613 · base no-git · clean                           ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-10-31T03:37:00.104Z` |
| Base commit | `no-git` |
| Branch | `no-git` |
| Code tree | `clean` |
| Files | 79 |
| Bytes | 764613 |
| Root SHA-256 | `8050e5f0f3dbc6c157e20d67f4aaae800ef8f6c74a38035a6558931bc192ec2f` |

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
| `bin/install.mjs` | 58140 | `35198862dfdfb0c2807c26cda239d9509e0e83ab53f668aeae8bc3d51a53d996` |
| `bin/quick-install.mjs` | 5685 | `fa97c3318d7630421e4f596044aa61da60c0f0d8b7533035f1013f462cedc078` |
| `docs/skills/bootstrap.md` | 574 | `0580d9dff2bf4a466597b5dcb41792ba7bba22175e37ff95dfa716acb057e51c` |
| `docs/skills/cpanel.md` | 1867 | `f056fa581f9a0fa268556d8769fc2c5389a864fbd552e90b1692efde0c003537` |
| `docs/skills/evidence-before-confidence.md` | 3140 | `6f05dd0fc50a97fb8d0eaf77be0f68aee5ee4760847e98a7d3ca3ffb51fe21f7` |
| `docs/skills/fastapi.md` | 1655 | `336760d1a90ba33630224332e9da615b214d3ec627095be9ced772a4fbfb3d34` |
| `docs/skills/first-principles.md` | 1752 | `a6081c550298eb25bbb9d887be98e642a7a4f239ece4b9c8b3cec9865297db3a` |
| `docs/skills/laravel.md` | 1630 | `f35dc9c1bdf4d6217993761bbc1db7beee164dba54e17e4e03ade68b3361c33a` |
| `docs/skills/llama-cpu.md` | 576 | `349dbaa66d650c820595498287f3799ac9efb39b11b7391f8680103e84380aef` |
| `docs/skills/next.md` | 1669 | `afdf6e2a125f8f9db4357c2d11375dd76f2d3b6d75fe3cf21550c105d6b6d254` |
| `docs/skills/node.md` | 1392 | `44a57ebd465774ec2dba3a736e27c24b4e0dd8370ee5a3ada1a642d5a3301f27` |
| `docs/skills/ollama.md` | 512 | `81dfb0ff1ba9b7596304e63c3e8b6ccbde844ea8ca6bfd7f79012795b4053813` |
| `docs/skills/python-regex.md` | 3759 | `c3afda66297c80485974f66c4212eec935bfccd4431c75c6c6f2210e1406aa95` |
| `docs/skills/python.md` | 1435 | `1fbd7bf69b3ee47b25c0ce08222989be4f2c74ce008f3702b7f913e584cf3b86` |
| `docs/skills/resource-optimization.md` | 1624 | `4180017cb251d46c33afae2b19b44d83ce7f52f6b315b3d0d5e0bd2bb182500e` |
| `docs/skills/scrape-verify.md` | 3098 | `2234c0e92c4ee379cf1268d6f2f62fbf12a1443f73f30f0d36a9f1b41671ef8d` |
| `docs/skills/server.md` | 1685 | `0149a648a6e8b4d8104097986e6796ceb224433707f5e73c281de5e7577eb4e3` |
| `docs/skills/tailwind.md` | 595 | `d89971988125a3d5cc457034e172ca54d758d03c277e9a8b57554b7d06e38e1b` |
| `docs/skills/typescript.md` | 638 | `07d314e2ab542bbfe39b5fdcfd1e4f8ebc255b61ca989c3f9970608e1095cc5e` |
| `docs/skills/uiux-delivery.md` | 3952 | `c2a66f4f4f3edbee5135b6e4b05ef82165f35baf1f9a7138c0d0f0d268394e15` |
| `docs/skills/web-delivery.md` | 4247 | `61ce13fc7897d4cb1a7bd59cfaa058ef6d94d6d7e7cb34295b179bc7e72cf0db` |
| `LICENSE` | 1961 | `d06b8b22307bf25fa4e3dba778ad2ccc1350c2e5cd1b5e6ed40c2de25b6cd95a` |
| `package.json` | 1433 | `3ebcdf5c8dff725ec58c41d880d7ceaaf8eb3fe6dd9921aa0617792f2f40f839` |
| `scripts/configure.mjs` | 14570 | `53c62929b01c0cc5bddc1a21935e88790c6f67a8d5b7989711b894a6da0faf18` |
| `scripts/identity.mjs` | 4807 | `1714c98c83d6c2eb28f908b1e253161077fcb6868afadd85ef835940af6e1d84` |
| `scripts/integrity.mjs` | 10134 | `2a3485b44f9e85be5493252f07c815386c8e9c96013ff3f434f368fd44f1b867` |
| `scripts/lsp-probe.mjs` | 6818 | `59f9dca359bcdc7dac673964beef7fc7d40e6e829e603ce3cd4e8bd8ecf3d2ae` |
| `scripts/setup.mjs` | 12807 | `f991bf440bbcd38819a40978e201817004e5574c4c45ed4f4921fa9ec0353d5f` |
| `src/agents.ts` | 13479 | `0e9fc2b22e375579fb2e77d8772717aec58cf31bd0bad91795cbd0dd4b46574e` |
| `src/ethics.ts` | 10670 | `db6c18984a5357106de459cd701c613c293971be372785594d57e83eeea7c921` |
| `src/generate.ts` | 5757 | `44d222baf6975fa4c3e127f94b96fcfb069378b2a0945d16a06a7c5955d4cd97` |
| `src/identity.ts` | 9611 | `79e7033922d8e1d31161b491a13724983c13cd073587fb854aac246f6bf237bf` |
| `src/plugin.ts` | 70792 | `cf201600c0a3beafad214ae977149d4bd70f0d32696304f9aa665d069ecc2a4d` |
| `src/roster.ts` | 46036 | `52f524400d65d941842efa1d1aac3fee991277caddf55a4126f268dcbaf83abc` |
| `src/runtime.ts` | 15970 | `dccfccb3906942d0bd4ac526e0958e3dd5cb6d57007cb58c47a20678ae7c7bae` |
| `src/zombie/circuitBreaker.ts` | 7498 | `ef7bc1023a1740d7284fabe9bfa0af7b65e5539d8f76fbdf03c17a2101ce4bd1` |
| `src/zombie/context.ts` | 14634 | `167f1ecaff1927ba194b73a7a4a83c43a86b600bd07dd756eacd2c22fac79049` |
| `src/zombie/defaults.ts` | 3489 | `d9219f68b9af5c7d52bb485b892353431be32c105dc55a27a31e26e118a9ffa1` |
| `src/zombie/focus.ts` | 13450 | `83b95b0216e699fda9047cad4ce854de8fd9c22182d174fa800f0f6ff411b14b` |
| `src/zombie/goalContract.ts` | 8750 | `372926ca33af52b2e678626b8183b310103c2fe50cf2fd58f107a0f55663d104` |
| `src/zombie/io.ts` | 5006 | `89b3f44e558f7b7d07735a9ac0a1fc3f610794c2ac10f50d3e7cd19b379d5dad` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/lspConfig.ts` | 6270 | `66d6ae3e695eca85a21563f9f42d3538005f3a753496e058ea79cd6be823e59a` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/memory.ts` | 12122 | `227a76748973dd5d0cada954fbaede9ad50a962a4bedf1d29641c656db80338f` |
| `src/zombie/models.ts` | 18053 | `e634f34a2101dfa0690bce06969f2376d34d8ae463addae0b9370e20ce96d25a` |
| `src/zombie/modes.ts` | 11052 | `b23eb59b3c27ffc147f702ba99cfc01e28eedb478ceef45c81cacd9ae4f8efc5` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 3675 | `11ac1335d655df0c16b877ffacd5e54fc4493b5a2276d1ad1d775f4bf413fa0a` |
| `src/zombie/responseGate.ts` | 33671 | `e279e70d3ea5b164ee1c6feee880187d6657c7904fe13c932ceb0aa71260c6a2` |
| `src/zombie/sanitize.ts` | 2173 | `d8fe339c61516c679ed35bbfe234375f977b7aff5673e375b4862ce8a15dc7ac` |
| `src/zombie/scan.ts` | 7562 | `9a9b657954f86a7f758a0d1fe17523a9d4c8496803c1e72017c3a7ce88116ade` |
| `src/zombie/server.ts` | 41401 | `16de3dd1e04fcd951e1c5233e86840e88c74502304a5296064c05a5926bb7221` |
| `src/zombie/skillCatalog.ts` | 20102 | `12d53ae97f48997ad06600236466e13bdc4c094aabf1b0b888bc576dee5fcc3f` |
| `src/zombie/skills.ts` | 5284 | `b8bc230b09d593dd2f6775f5c81a7b292e205ac2fd1e2b7cb43b78ddbe4c81d4` |
| `src/zombie/ssot.ts` | 6978 | `8a6086ac0c5a410895c5370485d71d799906e1c52cca6f9e46ca33865f67ea6f` |
| `src/zombie/syllabus.ts` | 11329 | `d9b1fd37fe7f67458b360ad53bad580fdb55e6c23ff1991e0dc6c0ff8925321f` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/circuitBreaker.test.ts` | 3676 | `08d6ece5d464358a6fe2837bbf7b2b091770fd7c14fa0e29a9f25fe5180922fc` |
| `test/context.test.ts` | 30441 | `6b93ddb4534444c009390cf069734c30d19263f667e413e9ce7c71467fbb4883` |
| `test/focus.test.ts` | 4051 | `47d93d65959c80c0b1ebb99b7cc5445d5dfbef536c9d3bc51bc90937b0e8b3a1` |
| `test/footprint.test.ts` | 2690 | `6c053dfca81fe65da03e216d72bea79abbd015ec73f2f714aeb1769db705b8e3` |
| `test/goalContract.test.ts` | 2925 | `25c20c0bce6857558634f96fa8de4ad5e62ef438028c898cab9e49ecd8abc813` |
| `test/identity.test.ts` | 2053 | `8e94dcbe93c41730398021122f5c55a180843e748154291177c4bb6e9c2da134` |
| `test/install.test.ts` | 24059 | `6b823ce34b1e98e9b2b16b1f27d1bab872ff3629bfce5e45f58f9f1bb925d230` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 3898 | `7a7b09e925f56524eeb14a380c318efd921db097065e1766225745a1b7ee4db5` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/memory.test.ts` | 5971 | `7be693ccf8cba4111b8f4a0a7d70d13f83934b20a0c085a9bb44eafd7315c7b8` |
| `test/memoryDialogue.test.ts` | 2567 | `b0be0a18a3e547f4452f18a50a8110964fbf366cd90833370f759dcbcac96b05` |
| `test/models.test.ts` | 13588 | `e95627522ea45b911d3d53221fe23d1cdc25fe32604b17c3a312d95d380c4510` |
| `test/modes.test.ts` | 4666 | `35f0830f7126a91027398b1fed04b73c3a77d482bf488987f041d6837094d6c2` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 55916 | `9911e979f32554ca3b286eba1d9f92b98caa27030619a927510467d50c4291c3` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/roster.test.ts` | 2895 | `4c2d42977c3ecf1ab57342771628e91e963449c21d95c9fbd8689be92cf022a1` |
| `test/sanitize.test.ts` | 1479 | `3007467c56d4af5e853e60ec08cddbeaf4f7f9281822cf8f1199e1618d7ae870` |
| `test/skillCatalog.test.ts` | 6533 | `c7743d5c6a0d39bb57bd3ebf9aa23004efae4ca5bfda903bf17033228ed487ad` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
