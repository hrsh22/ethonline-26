// Vitest resolves the package's client-condition export, which throws by
// design. The tests exercising server modules run in Node, which is exactly
// the environment the guard permits, so the guard is a no-op here; Next.js
// still enforces it in real builds through the react-server condition.
export {};
