# GEMINI.md

This file provides a comprehensive overview of the AgnoProject, its structure, and how to interact with it.

## Badges

[![Build Status](https://travis-ci.org/your-username/your-repo.svg?branch=master)](https://travis-ci.org/your-username/your-repo)
[![Coverage Status](https://coveralls.io/repos/github/your-username/your-repo/badge.svg?branch=master)](https://coveralls.io/github/your-username/your-repo?branch=master)
[![PyPI version](https://badge.fury.io/py/your-package.svg)](https://badge.fury.io/py/your-package)

## Project Overview

This project is a Python-based AI agent application built using the `agno` framework. It is designed to be a multi-agent system, with different "teams" of agents that can be configured to perform various tasks.

The main components of the project are:

*   **`app.py`**: The entry point of the application. It initializes the `AgentOS`, which is the core of the `agno` framework, and configures the different agent teams.
*   **`src/`**: This directory contains the source code for the agents, teams, and tools.
*   **`src/teams/`**: This directory contains the different agent teams. Each team is a collection of agents that work together to achieve a specific goal.
    *   **`src/teams/genie/`**: This directory contains the `GenieTeam`, which is an example of an agent team that uses the `GoogleMaps` tool.
*   **`src/agents/`**: This directory contains the individual agents that are used by the teams.
*   **`src/tools/`**: This directory contains the tools that the agents can use.
*   **`config/`**: This directory contains the configuration files for the project.

The project is configured to use a Postgres database for data persistence and the Gemini Large Language Model for its core intelligence.

## Message Processing via gRPC (Bidi Streaming)

This app integrates with an external MessageProcessor over gRPC bi-directional streaming. On incoming user messages, we open a stream, send the user message, serve on-demand history requests from the processor, and return the assistant’s final reply.

- Env vars:
  - `PROCESSOR_ADDR` (e.g., `localhost:50051`)
  - `MESSAGES_TABLE` (default: `messages`) and `MESSAGES_ORDER_COLUMN` (e.g., `created_at`) for chat history.
  - `RESPONSE_HANDLER_URL` if you also use REST sink (optional).

- Flow overview:
  - Send `UserMessage` into the stream.
  - On `Command{GET_MESSAGES}`, load messages from DB and send `MessagesChunk`.
  - Accumulate `AssistantChunk` tokens and on `AssistantFinal` persist and return the full text.

Python protobuf stubs must be generated under `src/processor/pb` using grpcio-tools.

## SQLAlchemy + Alembic

The app now uses SQLAlchemy (async) directly. Kafka dedup table is defined in code and created on startup. For managed schema changes use Alembic.

- Configure DB URL in `alembic.ini` (`sqlalchemy.url`) or via env when running.
- Create migration from current models:
  - `alembic revision --autogenerate -m "init"`
  - `alembic upgrade head`

Metadata source: `src/internal/store/token.py:metadata` (includes `oauth_tokens`, `audit_security`, `integration_logs`, `kafka_processed_messages`).

## Architecture

The project follows a typical agent-based architecture. The `AgentOS` class acts as the central orchestrator, managing the lifecycle of the agents and teams. The `GenieTeam` is a concrete implementation of a team, which in turn is composed of one or more `GenieAgent`s. The agents are equipped with tools, such as `GoogleMaps`, which they can use to interact with the external world. The communication between the user and the agents is handled by the `AgentOS`, which exposes a web application that can be used to interact with the agents.

## Building and Running

To run the project, you need to have Python and the required dependencies installed.

1.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
    *(Note: A `requirements.txt` file was not found. This is an inferred command.)*

2.  **Set up environment variables:**
    The project requires several environment variables to be set, such as `GOOGLE_API_KEY` and `GOOGLE_MAPS_API_KEY`. These can be set in a `.env` file.

3.  **Run the application:**
    ```bash
    python app.py
    ```
    The application will be served using the `agent_os_instance.serve()` method.

## Testing

To run the tests for the project, you can use the following command:

```bash
pytest
```

*(Note: This is an inferred command, as no testing framework was explicitly identified.)*

## Deployment

To deploy the project, you can use a cloud provider such as Google Cloud Platform or Amazon Web Services. The specific deployment steps will depend on the chosen provider.

## Contributing

Contributions to this project are welcome. Please follow these steps to contribute:

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix.
3.  Make your changes and commit them with a descriptive message.
4.  Push your changes to your fork.
5.  Create a pull request to the main repository.

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.

*(Note: A `LICENSE` file was not found. This is an inferred statement.)*

## Roadmap

*   **Add more agent teams:** The project currently has only one agent team. In the future, we plan to add more teams with different capabilities.
*   **Improve the user interface:** The current user interface is very basic. We plan to improve it to make it more user-friendly.
*   **Add more tools:** We plan to add more tools that the agents can use to interact with the external world.
*   **Improve the documentation:** We plan to improve the documentation to make it more comprehensive and easier to understand.

## Contact

For any questions or inquiries, please contact the project maintainer at [email protected]

## Acknowledgments

This project uses the following open source projects:

*   [Agno](https://github.com/tryagno/agno)
*   [FastAPI](https://fastapi.tiangolo.com/)
*   [Pydantic](https://pydantic-docs.helpmanual.io/)
*   [SQLAlchemy](https://www.sqlalchemy.org/)

## FAQ

**Q: How do I add a new agent team?**

A: To add a new agent team, you need to create a new directory in the `src/teams/` directory. This directory should contain a `team.py` file that defines the new team. You also need to create an `agent.py` file that defines the agent that will be used by the team.

**Q: How do I add a new tool?**

A: To add a new tool, you need to create a new Python file in the `src/tools/` directory. This file should define the new tool as a class that inherits from the `Tool` class.

## Support

If you need support for this project, you can open an issue on the GitHub repository.

## Code of Conduct

All contributors to this project are expected to adhere to the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/0/code_of_conduct/).

## Changelog

### [1.0.0] - 2023-10-26

*   Initial release.

## Authors

*   **[Your Name]** - *Initial work* - [your-github-profile](https://github.com/your-github-profile)

## Examples

Here are some examples of how to use the project:

*   **Get the weather forecast for a city:**
    ```
    {
        "team": "genie",
        "prompt": "What is the weather forecast for London?"
    }
    ```

*   **Find a restaurant near a location:**
    ```
    {
        "team": "genie",
        "prompt": "Find a restaurant near the Eiffel Tower"
    }
    ```

## Screenshots

_Coming soon..._

## Project Status

This project is currently in development and is not yet ready for production use.

## Development Conventions

The project follows a modular and structured approach to development.

*   **Separation of Concerns:** Agents, teams, and tools are organized into separate modules to promote separation of concerns and make the codebase easier to maintain and extend.
*   **Type Hinting and Data Validation:** The project uses Pydantic models for defining data structures, which suggests a convention of using type-hinting and data validation throughout the project.
*   **Configuration:** The project uses a `config.yml` file for configuration, which allows for easy modification of project settings withoutchanging the code.
