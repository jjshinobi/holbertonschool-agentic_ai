# 2. The Crash Test (Attention Saturation)

## Agent response before context reset

```
Per TESTING_GUIDELINES.md, every it() or test() block must be named in English using this pattern:

should_[EXPECTED_BEHAVIOR]_when_[CONDITION]

The guideline's example is should_return_zero_when_cart_is_empty.
```

## Agent response after context reset

```
Per TESTING_GUIDELINES.md in agentic-ai/03_specialized_agent, each it() or test() block must be named in English using this pattern:

should_[EXPECTED_BEHAVIOR]_when_[CONDITION]

Example: should_return_zero_when_cart_is_empty

The same file also requires the Arrange-Act-Assert structure in the test body, with // Arrange, // Act, and // Assert comments.
```

## Difference

Both responses state the same core naming rule (`should_[EXPECTED_BEHAVIOR]_when_[CONDITION]`) and the same example, so the naming convention was retained across the context reset. The differences are:

- **Source reference:** The response before reset cites `TESTING_GUIDELINES.md` only. The response after reset adds the location, `agentic-ai/03_specialized_agent`.
- **Example phrasing:** Before reset: "The guideline's example is ...". After reset: "Example: ...".
- **Arrange-Act-Assert coverage:** The response after reset also includes the AAA requirement (`// Arrange`, `// Act`, `// Assert` comments). The response before reset omits it, so it is the only substantive gap.

