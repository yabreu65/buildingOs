# AI Provider Configuration Specification

## Purpose

Runtime LLM provider selection with health checks, circuit breaker fallback, and graceful degradation when no provider is configured.

## Requirements

### Requirement: AI Provider Enum and Selection

The system SHALL define an `AI_PROVIDER` enum with values: `openai`, `opencode`, `ollama`, `none`. The active provider SHALL be selected via the `AI_PROVIDER` env var at startup.

#### Scenario: OpenAI provider selected

- GIVEN `AI_PROVIDER=openai` and `OPENAI_API_KEY` is set
- WHEN the assistant module initializes
- THEN the OpenAI adapter is registered as the active provider

#### Scenario: Ollama provider requires explicit URL

- GIVEN `AI_PROVIDER=ollama`
- WHEN the assistant module initializes
- THEN it uses `AI_OLLAMA_URL` if set, or returns an error if the URL is not configured (no hardcoded localhost default)

#### Scenario: Provider disabled

- GIVEN `AI_PROVIDER=none`
- WHEN the assistant module initializes
- THEN the assistant is disabled and returns a graceful "AI is not configured" message

### Requirement: Remove Hardcoded Localhost Defaults

The system SHALL NOT default `AI_OLLAMA_URL` to `localhost:11434`. If `AI_OLLAMA_URL` is not set and `AI_PROVIDER=ollama`, the system SHALL fail fast at startup with a clear error message.

#### Scenario: Missing Ollama URL fails fast

- GIVEN `AI_PROVIDER=ollama` and `AI_OLLAMA_URL` is not set
- WHEN the application starts
- THEN startup fails with an error indicating the URL is required

#### Scenario: No hardcoded localhost fallback

- GIVEN `AI_PROVIDER=ollama`
- WHEN the config is loaded
- THEN `AI_OLLAMA_URL` is `null` unless explicitly set via env var

### Requirement: Provider Health Check Endpoint

The system SHALL expose a health check endpoint that verifies connectivity to the active AI provider. The endpoint SHALL return provider status: `healthy`, `degraded`, or `unavailable`.

#### Scenario: Healthy provider

- GIVEN `AI_PROVIDER=openai` with valid credentials
- WHEN the health endpoint is called
- THEN it returns `{ provider: "openai", status: "healthy" }`

#### Scenario: Unavailable provider

- GIVEN `AI_PROVIDER=ollama` and the Ollama server is down
- WHEN the health endpoint is called
- THEN it returns `{ provider: "ollama", status: "unavailable" }`

#### Scenario: No provider configured

- GIVEN `AI_PROVIDER=none`
- WHEN the health endpoint is called
- THEN it returns `{ provider: "none", status: "disabled" }`

### Requirement: Circuit Breaker and Graceful Fallback

The system SHALL implement a circuit breaker that trips after 3 consecutive failures to the AI provider. When the circuit is open, requests SHALL return a graceful fallback message instead of timing out.

#### Scenario: Circuit breaker trips

- GIVEN the AI provider fails 3 consecutive requests
- WHEN a 4th request is made
- THEN the circuit is open and a fallback message is returned immediately

#### Scenario: Circuit breaker recovers

- GIVEN the circuit is open
- WHEN the health check confirms the provider is healthy again
- THEN the circuit closes and normal requests resume

#### Scenario: Graceful fallback message

- GIVEN the circuit is open for the AI provider
- WHEN a user sends a message to the assistant
- THEN the assistant responds with "AI service is temporarily unavailable. Please try again later."
