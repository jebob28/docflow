# PWA Service Worker SSL Troubleshooting

This document explains why you might encounter SSL errors when registering the Service Worker in a development environment and how to resolve them.

## The Problem

Progressive Web Apps (PWAs) require a secure context (HTTPS) to register a Service Worker. In development, we use self-signed certificates (`cert.pem` and `key.pem`) to enable HTTPS.

When the browser encounters a self-signed certificate that is not in its trusted store, it blocks the Service Worker registration with an error similar to:
`SecurityError: Failed to register a ServiceWorker: An SSL certificate error occurred when fetching the script.`

## Solutions

### 1. Trust the Certificate Manually (Easiest)
1. Open the application in your browser (e.g., `https://localhost:5174`).
2. You will likely see a "Your connection is not private" warning.
3. Click **Advanced** and then **Proceed to localhost (unsafe)**.
4. Once the page loads, the Service Worker should be able to register. If not, refresh the page.

### 2. Using `mkcert` (Recommended for Local Dev)
`mkcert` is a simple tool for making locally-trusted development certificates.

1. Install `mkcert`:
   ```bash
   # macOS
   brew install mkcert
   brew install nss # for Firefox support
   ```
2. Setup the local CA:
   ```bash
   mkcert -install
   ```
3. Generate new certificates in the project root:
   ```bash
   cd /Users/jeffersontadeuleite/Documents/Projetos/golang/Saas/GESTAO_DOCUMENTOS
   mkcert localhost 127.0.0.1 ::1
   ```
4. Rename the generated files to match the existing ones or update `vite.config.ts`:
   ```bash
   mv localhost+2.pem cert.pem
   mv localhost+2-key.pem key.pem
   ```
5. Restart the development server.

### 3. Disable PWA in Development
If you don't need to test PWA features during development, you can disable it in `vite.config.ts`:

```typescript
VitePWA({
  disable: process.env.NODE_ENV === 'development',
  // ... other config
})
```

## Manual vs. VitePWA Registration
The project currently has a manual registration in `src/main.tsx` and uses `vite-plugin-pwa` in `vite.config.ts`. To avoid conflicts, it is recommended to let `vite-plugin-pwa` handle the registration.

1. Remove the manual registration block in `src/main.tsx`:
   ```typescript
   // Remove this block
   if ('serviceWorker' in navigator) {
     window.addEventListener('load', () => {
       navigator.serviceWorker.register('/sw.js')...
     });
   }
   ```
2. `vite-plugin-pwa` will automatically inject the registration logic.
