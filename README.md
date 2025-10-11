# ruy-wiki-app

A Rust-based wiki application with a modern architecture consisting of:
- **Backend**: Rust API server using Axum framework
- **Frontend**: Leptos (Rust WebAssembly) application

## Project Structure

```
ruy-wiki-app/
├── backend/          # Rust API server (Axum)
│   ├── src/
│   │   └── main.rs   # Main API server code
│   └── Cargo.toml
├── frontend/         # Leptos frontend (WebAssembly)
│   ├── src/
│   │   ├── lib.rs    # Leptos components
│   │   └── main.rs   # Main entry point
│   ├── index.html    # HTML template
│   └── Cargo.toml
└── README.md
```

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable version)
- [Trunk](https://trunkrs.dev/) for building the Leptos frontend: `cargo install trunk`
- [wasm32-unknown-unknown target](https://rustwasm.github.io/docs/book/game-of-life/setup.html): `rustup target add wasm32-unknown-unknown`

## Backend API

### Features
- RESTful API built with Axum
- Async runtime with Tokio
- JSON serialization with Serde
- CORS support

### Building and Running

```bash
cd backend
cargo build
cargo run
```

The API server will start on `http://127.0.0.1:3000`

### API Endpoints

- `GET /` - API information
- `GET /health` - Health check endpoint

## Frontend

### Features
- Leptos framework (Rust WebAssembly)
- Client-side rendering (CSR)
- Reactive UI with signals
- Router for navigation

### Building and Running

```bash
cd frontend
trunk serve
```

The frontend will be available at `http://127.0.0.1:8080`

### Building for Production

```bash
cd frontend
trunk build --release
```

The built files will be in the `frontend/dist` directory.

## Development

### Running Both Projects

1. Start the backend server:
   ```bash
   cd backend
   cargo run
   ```

2. In a new terminal, start the frontend:
   ```bash
   cd frontend
   trunk serve
   ```

3. Open your browser to `http://127.0.0.1:8080`

## License

This project is open source and available under the MIT License.
