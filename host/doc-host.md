# HOST — Documentation

## Description

The **HOST** is the main physical machine used to run the project's dashboard and supporting services.

It hosts the application's **frontend**, **backend**, and the **Ollama server** used by the project.

## Structure

```text
host/
├── documentation.md
├── frontend/
└── backend/
```

### Frontend

The `frontend/` folder contains the project's **Next.js dashboard**.

It provides the user interface used to visualize and interact with the platform.

### Backend

The `backend/` folder contains the project's **Node.js backend**.

It provides the backend services and communication required by the dashboard and the rest of the project.

### Ollama

The HOST also runs an **Ollama server** used to provide the local AI/LLM service for the project.

The model used by the project is:

- **Model:** Llama 3.2
- **Size:** 3B parameters
- **Runtime:** Ollama

The Ollama server is started manually from **PowerShell** using:

```powershell
ollama serve
```

The local LLM can then be accessed by the project's backend when AI-based functionality is required.



## Role in the Project

The HOST acts as the **application and user-interface environment** of the project.

It provides:

- The Next.js frontend/dashboard.
- The Node.js backend.
- The local Ollama server.
- The interface through which the user can interact with and monitor the platform.

The general structure is:

```text
                 HOST
                  │
        ┌─────────┼─────────┐
        │         │         │
        ▼         ▼         ▼
   Frontend    Backend    Ollama
   Next.js     Node.js    AI/LLM
        │         │
        └────┬────┘
             │
             ▼
       Project Platform
```



## Important Note

This documentation describes the role of the HOST at a high level.

Detailed configuration, dependencies, environment variables, commands, and implementation-specific information should be documented inside the corresponding `frontend/` and `backend/` folders.