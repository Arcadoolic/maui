set shell := ["bash", "-cu"]

# List available recipes
default:
    @just --list

# Install dependencies
install:
    npm install

# Run the app in development mode (Electron, hot-reload)
serve: install
    npm run electron:serve

# Build production Electron app
build: install
    npm run electron:build

# Lint and auto-fix files
lint:
    npm run lint
