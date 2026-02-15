# Research Papers Index

Academic evidence base supporting Hypergen X's AI integration architecture (Scaffold+Complete pattern).

> **23 papers** verified via Semantic Scholar API, organized by relevance to our design decisions.

## Category 1: Template + AI Hybrid Approach (3 papers)

The foundational evidence for our Scaffold+Complete pattern.

| # | Paper | Authors | Year | Venue | Citations | Key Finding |
|---|-------|---------|------|-------|-----------|-------------|
| 1 | [iEcoreGen](https://www.semanticscholar.org/paper/68c6d1decf4b6fa29ae86e735e9a7dc5eb70517c) | He et al. | 2025 | arXiv | 0 | Template + LLM = 5-52% Pass@1 improvement over LLM-only |
| 2 | [Self-Planning Code Gen](https://www.semanticscholar.org/paper/47c3b8dd2c8a9326249ac98900b2c3fc71f46ab1) | Jiang et al. | 2023 | ACM TOSEM | 192 | Plan/skeleton → implement improves code quality |
| 3 | [InCoder](https://www.semanticscholar.org/paper/5288b9f3a9f575543f44c39e1d3b78b3ca4c99da) | Fried et al. | 2022 | ICLR 2023 | 817 | Code infilling given context (scaffold) works well |

**Relevance**: Directly validates our architecture — templates generate skeleton, AI fills logic.

## Category 2: Security Risks of Pure AI Generation (4 papers)

Why templates should handle deterministic parts (structure, imports, boilerplate).

| # | Paper | Authors | Year | Venue | Citations | Key Finding |
|---|-------|---------|------|-------|-----------|-------------|
| 4 | [Asleep at the Keyboard](https://www.semanticscholar.org/paper/6e5eb6167d9766fbb4d14611d15cf95d7b75fb9d) | Pearce et al. | 2021 | IEEE S&P | 615 | ~40% of Copilot's security-sensitive code has vulnerabilities |
| 5 | [Insecure Code with AI](https://www.semanticscholar.org/paper/ce3f027b68dad014a58aa35f52380932c8d0b209) | Perry et al. | 2022 | ACM CCS 2023 | 281 | AI users write less secure code AND are overconfident |
| 6 | [SALLM](https://www.semanticscholar.org/paper/c6649c4247282c3e46593e26c5e0429fcb7c7673) | Siddiq et al. | 2023 | ASE 2024 | 42 | LLMs generate insecure code across multiple CWE categories |
| 7 | [Constrained Decoding](https://www.semanticscholar.org/paper/bdf6c0ce7a0a7ea9a724aa802d87e0bedebbbd38) | Fu et al. | 2024 | arXiv | 30 | Structural constraints can prevent insecure generation |

**Relevance**: Justifies limiting AI to business logic only. Templates eliminate security risks for deterministic parts.

## Category 3: Hallucination / Dependency Risks (5 papers)

Why we validate imports and cross-reference package.json.

| # | Paper | Authors | Year | Venue | Citations | Key Finding |
|---|-------|---------|------|-------|-----------|-------------|
| 8 | [Package Hallucinations](https://www.semanticscholar.org/paper/b76124ef53341af42d6d582ffe340cd0ddb49fc8) | Spracklen et al. | 2024 | USENIX Sec 2025 | 40 | ~20% of code samples recommend nonexistent packages |
| 9 | [LLM Hallucinations Practical](https://www.semanticscholar.org/paper/75bd806794649ba22d6e994c7ddbdbb169c620fd) | Zhang et al. | 2024 | ACM POPL | 93 | API misuse, nonexistent methods, wrong params |
| 10 | [Beyond Functional Correctness](https://www.semanticscholar.org/paper/31a23ae2821910f6b26d8991e953d20ae6d2297f) | Liu et al. | 2024 | arXiv | 227 | Even correct code can contain hallucinations |
| 11 | [Hallucination Taxonomy](https://www.semanticscholar.org/paper/ab90297f5a95b79d67620c32d2474c9a1dfef8c8) | Lee et al. | 2025 | arXiv | 9 | 5 primary hallucination categories, HalluCode benchmark |
| 12 | [MARIN](https://www.semanticscholar.org/paper/f7414e716b9c9e5db8092840307067a5c8f838d8) | Chen et al. | 2025 | SIGSOFT FSE | 4 | Hierarchical dependency awareness constrains LLM output |

**Relevance**: Validates our `requireKnownImports` guardrail and import validation in `output-validator.ts`.

## Category 4: Context Injection / RAG for Code (3 papers)

Why explicit context injection (files, configs, step results) improves generation quality.

| # | Paper | Authors | Year | Venue | Citations | Key Finding |
|---|-------|---------|------|-------|-----------|-------------|
| 13 | [RepoCoder](https://www.semanticscholar.org/paper/af5c7848417882012203ac21399977ebda695a2b) | Zhang et al. | 2023 | EMNLP 2023 | 371 | Repo context injection significantly improves completion |
| 14 | [REDCODER](https://www.semanticscholar.org/paper/c56aced0f0c5cfebefadb530cb08d736c3ac5c05) | Parvez et al. | 2021 | EMNLP 2021 | 248 | Retrieval-augmented code generation improves quality |
| 15 | [Multi-Retrieval Augmented](https://www.semanticscholar.org/paper/d92a423e09804595c8a2e241f890f5a24d326bb5) | Tan et al. | 2024 | ACM TOSEM | 19 | Combining multiple retrieval strategies improves generation |

**Relevance**: Validates our `ContextCollector` and `AIContextConfig` design — explicit file inclusion improves results.

## Category 5: Output Validation / Structured Generation (2 papers)

Why syntax and schema validation matter, and how retry-with-feedback works.

| # | Paper | Authors | Year | Venue | Citations | Key Finding |
|---|-------|---------|------|-------|-----------|-------------|
| 16 | [SynCode](https://www.semanticscholar.org/paper/46a41357eadac1459c81588136c5c053abfeefe4) | Ugare et al. | 2024 | TMLR | 40 | Grammar-augmented generation ensures syntactic correctness |
| 17 | [Efficient Guided Gen (Outlines)](https://www.semanticscholar.org/paper/c4ceaef35bca063815f50d90a087acbd07a65478) | Willard & Louf | 2023 | arXiv | 82 | FSM-based output schema enforcement |

**Relevance**: Validates our `output-validator.ts` approach and retry-with-feedback loop (modeled after iEcoreGen's compiler error → correction cycle).

## Category 6: Few-Shot Prompting Effectiveness (3 papers)

Why we support `examples` in AI steps and the `{% ai %}` tag.

| # | Paper | Authors | Year | Venue | Citations | Key Finding |
|---|-------|---------|------|-------|-----------|-------------|
| 18 | [Few-Shot Code Gen Tools](https://www.semanticscholar.org/paper/7ffb212356df9980347b3d3b9910dfba75a5d0c7) | Bareiss et al. | 2022 | arXiv | 92 | Examples significantly improve output without fine-tuning |
| 19 | [AceCoder](https://www.semanticscholar.org/paper/eaa8e175c0234f4fa33f12e2d1fca05ef817d5cb) | Li et al. | 2024 | ACM TOSEM | 50 | Similar code examples as few-shot prompts improve generation |
| 20 | [Few-Shot Project-Specific](https://www.semanticscholar.org/paper/53661ff6fdbfb8557c5b19895fad151792c62da7) | Ahmed & Devanbu | 2022 | ASE 2022 | 315 | Project context in examples dramatically improves quality |

**Relevance**: Validates our `AIExample` type and few-shot support in `PromptPipeline`.

## Category 7: Benchmarks and Metrics (3 papers)

Context for understanding AI code generation performance expectations.

| # | Paper | Authors | Year | Venue | Citations | Key Finding |
|---|-------|---------|------|-------|-----------|-------------|
| 21 | [Codex / HumanEval](https://www.semanticscholar.org/paper/acbdbf49f9bc3f151b93d9ca9a06009f4f6eb269) | Chen et al. (OpenAI) | 2021 | arXiv | 8153 | Best models solve ~28.8% Pass@1, establishing baseline |
| 22 | [MultiPL-E](https://www.semanticscholar.org/paper/f9acfdf58ccc27ac7d4b815ef8a2b9e03c5b215a) | Cassano et al. | 2023 | IEEE TSE | 217 | >50% quality degradation for non-Python languages |
| 23 | [Survey on LLMs for Code Gen](https://www.semanticscholar.org/paper/c8b18682965ff9dccc0130dab3d679f78cefa617) | Jiang et al. | 2024 | arXiv | 579 | Comprehensive survey of state of the art |

**Relevance**: Provides baseline expectations and justifies the Scaffold+Complete approach — pure LLM generation has fundamental limits that templates can compensate for.

---

## How This Research Informed Our Design

| Design Decision | Supporting Papers |
|----------------|-------------------|
| Template + AI hybrid (not pure AI gen) | #1, #2, #3, #21 |
| Templates handle structure, AI handles logic | #4, #5, #6, #7 |
| Import validation against package.json | #8, #9, #10, #11, #12 |
| Explicit context file injection | #13, #14, #15 |
| Syntax validation + retry-with-feedback | #1, #16, #17 |
| Few-shot examples support | #18, #19, #20 |
| Cost tracking and budgeting | #21, #22 (token economics context) |
| Language-agnostic approach | #22 (quality varies by language) |

---

*Last updated: February 2026*
*Verified via Semantic Scholar API*
