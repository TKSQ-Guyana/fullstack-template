// Committed placeholder. In development the vite plugin serves this path with
// real values; in a container docker/40-runtime-config.sh overwrites the file
// at start-up. Empty here so `vite preview` and a bare static serve fall
// through to build-time values (config/runtime.ts precedence).
window.__ENV__ = {}
