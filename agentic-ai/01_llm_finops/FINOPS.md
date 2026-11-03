# LLM FinOps: Cost of a Documentation Agent in an Error Loop

## 1. The agent's system prompt

```text
You are an expert software documentation agent.
Your role is to read the provided code and generate detailed header comments for each method.
Constraints: Use JSDoc format, list all parameters and the return type.
Generate only the comments, do not add any other narrative text.
Code to analyze:
```

## 2. Token count measurement

| Item                             | Value                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Token count of the system prompt | 58 tokens                                                                                     |
| Tokenizer used                   | [https://platform.openai.com/tokenizer](https://platform.openai.com/tokenizer)                |
| Model used                       | GPT 5.x                                                                                       |

## 3. Cost of a single execution

Assumptions from the exercise:

- System prompt: 58 tokens
- Injected code file: exactly 15,000 tokens
- Agent response: 500 tokens
- Rates: $5 / 1M input tokens, $15 / 1M output tokens

Calculation:

| Quantity | Tokens | Rate | Cost |
| --- | --- | --- | --- |
| Input (prompt 58 + code 15,000) | 15,058 | $5 / 1M | 15,058 x 5e-6 = $0.075290 |
| Output (response) | 500 | $15 / 1M | 500 x 15e-6 = $0.007500 |
| **Total for one execution** | | | **$0.082790** |

## 4. Error loop of 10 iterations

Each iteration keeps the full conversation history: the system prompt and the 15,000-token code file are re-sent every time, and each previous 500-token response is added to the context of the next call.

Input tokens at iteration i (1-indexed):

```text
input(i) = 58 + 15,000 + 500 x (i - 1) = 15,058 + 500 x (i - 1)
```

Per-iteration output is always 500 tokens.

| Iteration | Input tokens | Input cost | Output cost | Iteration cost | Cumulative cost |
| --- | --- | --- | --- | --- | --- |
| 1 | 15,058 | $0.075290 | $0.007500 | $0.082790 | $0.082790 |
| 2 | 15,558 | $0.077790 | $0.007500 | $0.085290 | $0.168080 |
| 3 | 16,058 | $0.080290 | $0.007500 | $0.087790 | $0.255870 |
| 4 | 16,558 | $0.082790 | $0.007500 | $0.090290 | $0.346160 |
| 5 | 17,058 | $0.085290 | $0.007500 | $0.092790 | $0.438950 |
| 6 | 17,558 | $0.087790 | $0.007500 | $0.095290 | $0.534240 |
| 7 | 18,058 | $0.090290 | $0.007500 | $0.097790 | $0.632030 |
| 8 | 18,558 | $0.092790 | $0.007500 | $0.100290 | $0.732320 |
| 9 | 19,058 | $0.095290 | $0.007500 | $0.102790 | $0.835110 |
| 10 | 19,558 | $0.097790 | $0.007500 | $0.105290 | $0.940400 |

Totals over the loop:

| Quantity | Tokens | Cost |
| --- | --- | --- |
| Total input | 173,080 | $0.865400 |
| Total output | 5,000 | $0.075000 |
| **Cumulative cost of the error loop** | | **$0.940400** |

## 5. Self-assessment

**Verification of the math.** The per-iteration inputs form an arithmetic sequence 15,058 + 500 x (i - 1). The closed-form check:

```text
Total input = 10 x 15,058 + 500 x (0 + 1 + ... + 9)
            = 150,580 + 500 x 45
            = 150,580 + 22,500
            = 173,080 tokens
Total input cost  = 173,080 x 5e-6 = $0.865400
Total output cost = 5,000 x 15e-6  = $0.075000
Total             = $0.940400
```

**Optimization: context truncation.** The failed responses of an error loop are useless baggage: the next attempt does not need them, only the system prompt and the code do. If the agent truncates the context and re-sends only the system prompt (58 tokens) plus the code (15,000 tokens) at each iteration, every iteration costs the same as iteration 1:

```text
Truncated loop: 10 x ($0.075290 + $0.007500) = $0.827900
Savings: $0.940400 - $0.827900 = $0.112500 (-12%)
```

Complementary measures: cap the number of retries and fail fast (an error loop of 10 identical failures should never run unattended), use provider-side prompt caching so the repeated 15,000-token code prefix is billed at a discounted rate, and fix the root cause that makes the agent fail repeatedly instead of paying for the same context ten times.
