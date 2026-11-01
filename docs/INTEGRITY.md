# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  98204656dfbdacb87afb97174887cf4254c184159093c40c18dd9fe3df6dd692  ║
║  files 105 · bytes 988702 · base ae09518 · dirty                         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-11-01T09:55:14.500Z` |
| Base commit | `ae09518` |
| Branch | `murubbi` |
| Code tree | `dirty` |
| Files | 105 |
| Bytes | 988702 |
| Root SHA-256 | `98204656dfbdacb87afb97174887cf4254c184159093c40c18dd9fe3df6dd692` |

## Scope

- `src`
- `bin`
- `scripts`
- `test`
- `mcp`
- `docs/skills`
- `install.sh`
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
| `bin/install.mjs` | 67893 | `17d027c776500599d3396d2ce7932b7ef1f83a69840f04045d3f8a1efaddabe9` |
| `bin/quick-install.mjs` | 5685 | `fa97c3318d7630421e4f596044aa61da60c0f0d8b7533035f1013f462cedc078` |
| `docs/skills/bootstrap.md` | 574 | `0580d9dff2bf4a466597b5dcb41792ba7bba22175e37ff95dfa716acb057e51c` |
| `docs/skills/cpanel.md` | 1867 | `f056fa581f9a0fa268556d8769fc2c5389a864fbd552e90b1692efde0c003537` |
| `docs/skills/evidence-before-confidence.md` | 3140 | `6f05dd0fc50a97fb8d0eaf77be0f68aee5ee4760847e98a7d3ca3ffb51fe21f7` |
| `docs/skills/fastapi.md` | 1655 | `336760d1a90ba33630224332e9da615b214d3ec627095be9ced772a4fbfb3d34` |
| `docs/skills/first-principles.md` | 1752 | `a6081c550298eb25bbb9d887be98e642a7a4f239ece4b9c8b3cec9865297db3a` |
| `docs/skills/laravel-market.md` | 4175 | `4fa4ae4e951967bfa750d417dc67e16b41c478b48035a1e34d62b065d8475fac` |
| `docs/skills/laravel.md` | 1910 | `51b883d978bb3413e243cee90e00db1e25a6b200fd0eaf38d4576aedbb079dec` |
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
| `install.sh` | 3471 | `6890661ad01f1a3624d3fedfe68fbb174af98d19584fe2d9b4ac08240270f4ac` |
| `LICENSE` | 1961 | `d06b8b22307bf25fa4e3dba778ad2ccc1350c2e5cd1b5e6ed40c2de25b6cd95a` |
| `mcp/image-brand/e2e-live.mjs` | 2781 | `8ae7c8c7ce022cbb80f049d56aeec5719dfc69cc90ee87c3aed8006454ebc04f` |
| `mcp/image-brand/fixtures.py` | 1731 | `bee4ffeed922dafa6a11c47dfca4ff1c9e647dbf12038cc8cff3d6d31ff1ea44` |
| `mcp/image-brand/mcp-client.mjs` | 296 | `131a4fcb5d60dff790af5ba3aaedd9d919cea7ea96140e73c4d616947925fbd6` |
| `mcp/image-brand/pipeline.py` | 18973 | `4db5032cd7d421336588865cc35f0ec0735ed749548d0ec708dc733c5b168868` |
| `mcp/image-brand/README.md` | 6423 | `5f503f2ccaf61d9ebf70ac82d583688d50c3b29ae4ea7026c7b94b7be33a6dda` |
| `mcp/image-brand/selfcheck.mjs` | 2285 | `322ec82337ca5c825291a1ada68eb931ee80457a2770b09e98866ea5d97f6ac5` |
| `mcp/image-brand/server.mjs` | 23902 | `9f9ed81404ea74372cc6ef8a8301c7ccc39b4274b755425779dc62f012d477b7` |
| `mcp/image-brand/test/image-brand.test.mjs` | 5838 | `ce173b30fb14d338f2eeac01f6ab8a35dbcce407f4d435472f7c1d9a557bc663` |
| `mcp/public-api/README.md` | 4109 | `750438f9e795c5d1676a71eb7495e3e3146180258766445eca8f5f2f51ab1bae` |
| `mcp/public-api/selfcheck.mjs` | 2649 | `cd5083dbd0126e4f641c54f1d715c3ac6c48f6434a87ee5516cc9e3ed226f58f` |
| `mcp/public-api/server.mjs` | 3188 | `709ded85e81ecfb16c9df0650735e22a7bc9327383be133720e72c0e3bd54e3e` |
| `mcp/public-api/sources.mjs` | 17233 | `1d807f81ce5f4b51629f597118a8429541722c0f6d0e9088cf952224f0dc68a4` |
| `mcp/public-api/test/public-api.test.mjs` | 3599 | `eb0ffc399dfab82869c693130792b2da6c911e27126cffc8f4fbd5619c26ebd1` |
| `mcp/shared/client.mjs` | 2609 | `acc65207ae92b58082f2ff1df8570d076c710b5303a6ea7fe51f6ac1a62c088c` |
| `package.json` | 2247 | `9d4e4041a2de2caeeeef6b8e6240c4ccdb229dd8fc5f322aad736089823793a2` |
| `scripts/allow-always-check.mjs` | 3138 | `514642a97a4f3a3a3f67b68789d8b2e1665680d2623e79d14ba640c6d395c257` |
| `scripts/audit-install.mjs` | 5416 | `171914479782b23b7d19a72b841006865ef9be69e561cbc5a271ef49eb18cf52` |
| `scripts/configure.mjs` | 14570 | `53c62929b01c0cc5bddc1a21935e88790c6f67a8d5b7989711b894a6da0faf18` |
| `scripts/e2e-install.mjs` | 9304 | `915686bebd068cd67210f8bf03f580aa38d263873295fcfe7b28c06f4aabc136` |
| `scripts/identity.mjs` | 4840 | `6cd9ec01f95af6a376745b4db047abd8ae77e5867fd5d6a91a99c82f1033f32d` |
| `scripts/integrity.mjs` | 10209 | `becd315c0a79043b6b372837fc89174db99393fa4da2561ba9743918e87143df` |
| `scripts/lsp-diagnostics.mjs` | 8920 | `9ee3431929bf4fec4e39d822e0a1876380229fda3408b7fa8c2f326a51ab4121` |
| `scripts/lsp-probe.mjs` | 7294 | `77f7d44d6529d2d73376c4ca09053c046d3209af0b90ec1da5fda2335c4fe7ae` |
| `scripts/setup.mjs` | 12807 | `f991bf440bbcd38819a40978e201817004e5574c4c45ed4f4921fa9ec0353d5f` |
| `src/agents.ts` | 13479 | `0e9fc2b22e375579fb2e77d8772717aec58cf31bd0bad91795cbd0dd4b46574e` |
| `src/ethics.ts` | 12947 | `0869cf72ec8665b130f1abb31c85c1d11c93d97cabd7e6387e7684d7e70c5ff3` |
| `src/generate.ts` | 6924 | `be7e240994d953a8fb8e3864558f6609389e1780556b7182a58a0e21a7827be6` |
| `src/identity.ts` | 10286 | `1abe79135f822b8e4435cbad45e949e4411305b4d915b0faecb132fe9e703d47` |
| `src/install/space.ts` | 3813 | `098fe34dfe34003f1ad66cb1e6aa32f4ef8415bc9d81f198c61776fbd31f4931` |
| `src/plugin.ts` | 72440 | `df05c7a3714417d36e9a2521cad7d21cc2eda3a8bbaa2009246ea85acb4d6db1` |
| `src/roster.ts` | 48945 | `1d071371e66dea015416d0424b74c9fb4d97763247aeed2b349d88b29d08b141` |
| `src/runtime.ts` | 15970 | `dccfccb3906942d0bd4ac526e0958e3dd5cb6d57007cb58c47a20678ae7c7bae` |
| `src/zombie/circuitBreaker.ts` | 7498 | `ef7bc1023a1740d7284fabe9bfa0af7b65e5539d8f76fbdf03c17a2101ce4bd1` |
| `src/zombie/context.ts` | 15172 | `12db5acad222189d0294c975fc85b9ffcd34c52d0f29e003b5988a7fe5c31dc5` |
| `src/zombie/defaults.ts` | 3489 | `d9219f68b9af5c7d52bb485b892353431be32c105dc55a27a31e26e118a9ffa1` |
| `src/zombie/focus.ts` | 13450 | `83b95b0216e699fda9047cad4ce854de8fd9c22182d174fa800f0f6ff411b14b` |
| `src/zombie/goalContract.ts` | 10145 | `5271ff1620e43787e7ee133f46886751acaf941b2243c1b2899c43940f3ba628` |
| `src/zombie/io.ts` | 5006 | `89b3f44e558f7b7d07735a9ac0a1fc3f610794c2ac10f50d3e7cd19b379d5dad` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/lspConfig.ts` | 7794 | `afcb29b0335f0d693780057eedb9db4f37310b4dddde1b083d5b972f0bf7f66b` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/memory.ts` | 12122 | `227a76748973dd5d0cada954fbaede9ad50a962a4bedf1d29641c656db80338f` |
| `src/zombie/models.ts` | 18053 | `e634f34a2101dfa0690bce06969f2376d34d8ae463addae0b9370e20ce96d25a` |
| `src/zombie/modes.ts` | 11052 | `b23eb59b3c27ffc147f702ba99cfc01e28eedb478ceef45c81cacd9ae4f8efc5` |
| `src/zombie/onboarding.ts` | 13844 | `7ee49c13c790326ae8d148e5a5ece209fa0a1c145ddd544b5e69a085ae7e1591` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 3675 | `11ac1335d655df0c16b877ffacd5e54fc4493b5a2276d1ad1d775f4bf413fa0a` |
| `src/zombie/responseGate.ts` | 33671 | `e279e70d3ea5b164ee1c6feee880187d6657c7904fe13c932ceb0aa71260c6a2` |
| `src/zombie/sanitize.ts` | 2173 | `d8fe339c61516c679ed35bbfe234375f977b7aff5673e375b4862ce8a15dc7ac` |
| `src/zombie/scan.ts` | 7562 | `9a9b657954f86a7f758a0d1fe17523a9d4c8496803c1e72017c3a7ce88116ade` |
| `src/zombie/server.ts` | 61830 | `c611ac3918043c86b131a72081db826021ce6cb87411584d9c9862c66903c771` |
| `src/zombie/skillCatalog.ts` | 21117 | `62edad5447390cd3f3d00becc2c24d18eb264ea6a60043dff08e92d83773827f` |
| `src/zombie/skills.ts` | 5284 | `b8bc230b09d593dd2f6775f5c81a7b292e205ac2fd1e2b7cb43b78ddbe4c81d4` |
| `src/zombie/ssot.ts` | 6978 | `8a6086ac0c5a410895c5370485d71d799906e1c52cca6f9e46ca33865f67ea6f` |
| `src/zombie/syllabus.ts` | 11329 | `d9b1fd37fe7f67458b360ad53bad580fdb55e6c23ff1991e0dc6c0ff8925321f` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/audit-install.test.ts` | 4155 | `78ac9b2a258dba24cc55474ec8d03baf2ef4c66d1797e272717c0b369cfd8d44` |
| `test/circuitBreaker.test.ts` | 3676 | `08d6ece5d464358a6fe2837bbf7b2b091770fd7c14fa0e29a9f25fe5180922fc` |
| `test/context.test.ts` | 31105 | `970294e71b87bfc4b6dfd7db9e706ce1edb6a58fa3e8b39b93d8e357e74b7c92` |
| `test/focus.test.ts` | 4051 | `47d93d65959c80c0b1ebb99b7cc5445d5dfbef536c9d3bc51bc90937b0e8b3a1` |
| `test/footprint.test.ts` | 2690 | `6c053dfca81fe65da03e216d72bea79abbd015ec73f2f714aeb1769db705b8e3` |
| `test/goalContract.test.ts` | 4268 | `0b06a8bb735d99d4bd732d27989a3523e3622a53a700e5cdaa784fbdeb833da5` |
| `test/identity.test.ts` | 3944 | `ee835ab860ef3efd03cc9f2eefdba10fdeeda791e2f18b1453fa6f1e75fc03fe` |
| `test/install.test.ts` | 25183 | `ac1ed0842a77134293e96887fd633fa89bf928d191d8caa02711278cf157603c` |
| `test/installSpace.test.ts` | 2234 | `8d589c1d8e2423869c788c11435e0fc23be6abc5145d7b66c9fb54cc09671c71` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 5170 | `074bd54fd9163aaaa1ccdf9cbe6b647ca0c60e150cccb2553cd42330996f8952` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/memory.test.ts` | 5971 | `7be693ccf8cba4111b8f4a0a7d70d13f83934b20a0c085a9bb44eafd7315c7b8` |
| `test/memoryDialogue.test.ts` | 2567 | `b0be0a18a3e547f4452f18a50a8110964fbf366cd90833370f759dcbcac96b05` |
| `test/models.test.ts` | 13588 | `e95627522ea45b911d3d53221fe23d1cdc25fe32604b17c3a312d95d380c4510` |
| `test/modes.test.ts` | 4666 | `35f0830f7126a91027398b1fed04b73c3a77d482bf488987f041d6837094d6c2` |
| `test/onboarding.test.ts` | 6117 | `9e45cc4cbeaed79e4f5644f28d4faea87ee34152e96972973c93774c9ae344ae` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 61912 | `9662453d2792f138a59fe62492f6bd91355ae06223641bb8accef76a92138609` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/roster.test.ts` | 2895 | `4c2d42977c3ecf1ab57342771628e91e963449c21d95c9fbd8689be92cf022a1` |
| `test/sanitize.test.ts` | 1479 | `3007467c56d4af5e853e60ec08cddbeaf4f7f9281822cf8f1199e1618d7ae870` |
| `test/skillCatalog.test.ts` | 7561 | `1f4b8479d9528d1ba72a5ce1bf4a776924be07d81fcbba64d7e44e794de09730` |
| `test/tools.test.ts` | 5560 | `74eee0129d493f99d50af154ebc7ddc12cb897346acaeb9ee5a9e3f982af2c89` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
