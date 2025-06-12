import { defineConfig } from "vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  optimizeDeps: {
    exclude: ['vm-browserify'],
  },
  plugins: [
    nodePolyfills({
      exclude: ['vm'], // <--- prevent polyfilling vm
    })
  ],
  resolve: {
    alias: {
      // You can polyfill node modules like `os`, `path`, etc. to browser-friendly versions
      os: 'node-os-browserify',
      // Disable the `vm` module, effectively excluding `vm-browserify`
      vm: path.resolve(__dirname, 'src/helpers/empty.ts'), 

      '@classes': path.resolve(__dirname, 'src/classes'),
      '@endpoints': path.resolve(__dirname, 'src/endpoints'),
      '@src': path.resolve(__dirname, 'src'),
    }
  },
  build: {
    chunkSizeWarningLimit: 1000,
    target: "esnext",
    outDir: "dist",
    rollupOptions: {
      external: ['bottleneck'],
      input: "./src/index.ts",
      output: {
        entryFileNames: "worker.js",
        format: "esm",
        manualChunks(id) {

          const normalizedId = id.replace(/\\/g, '/');

          // chunk own modules
          if (!normalizedId.includes('node_modules')) {

            if (normalizedId.includes('src/classes')) {
              return 'own_classes';
            }

            if (normalizedId.includes('src/endpoints')) {
              return 'own_endpoints';
            }

            if (normalizedId.includes('src/helpers')) {
              return 'own_helpers';
            }

              return 'own_main';
          }
          
          // chunk node_modules
          if (normalizedId.includes('node_modules')) {

            // Split other libraries as before
            if (normalizedId.includes('@slack/web-api')) {
              return 'vendor_slack_webapi';
            }

            if (normalizedId.includes('os')) {
              return 'vendor_os';
            }

            // Split other libraries as before
            if (normalizedId.includes('lodash')) {
              return 'vendor_lodash';
            }

            // Split other libraries as before
            if (normalizedId.includes('@slack/webhook')) {
              return 'vendor_slack_webhook';
            }

            if (normalizedId.includes('zod')) {
              return 'vendor_zod';
            }

            if (normalizedId.includes('chanfana')) {
              return 'vendor_chanfana';
            }

            if (normalizedId.includes('hono')) {
              return 'vendor_hono';
            }

            if (normalizedId.includes('xlsx')) {
              return 'vendor_xlsx';
            }

            if (normalizedId.includes('xlsx-populate')) {
                return 'vendor_xlsx-populate';
            }

            if (normalizedId.includes('sprintf')) {
                return 'vendor_sprintf';
            }

            // Match only HubSpot CRM API modules
           let match = normalizedId.match(/@hubspot\/api-client\/lib\/codegen\/crm\/([^/]+)\//);

            if (match) {
              const objectType = match[1]; // e.g., "deals", "companies", "contacts"
              return `vendor_hubspot_${objectType}`;
            }

            match = normalizedId.match(/@hubspot\/api-client\/lib\/codegen\/cms\/([^/]+)\//);
            if (match) {
              const objectType = match[1];
              return `vendor_hubspot_${objectType}`;
            }

            if (normalizedId.includes('@hubspot/api-client')) {
              if (normalizedId.includes('crm')) {
                return 'vendor_hubspot_crm';
              }

              if (normalizedId.includes('files')) {
                return 'vendor_hubspot_files';
              }

              if (normalizedId.includes('marketing')) {
                return 'vendor_hubspot_marketing';
              }

              if (normalizedId.includes('oauth')) {
                return 'vendor_hubspot_oauth';
              }

              if (normalizedId.includes('events')) {
                return 'vendor_hubspot_events';
              }

              if (normalizedId.includes('settings')) {
                return 'vendor_hubspot_settings';
              }

              if (normalizedId.includes('webhooks')) {
                return 'vendor_hubspot_webhooks';
              }

              if (normalizedId.includes('cms')) {
                return 'vendor_hubspot_cms';
              }

              if (normalizedId.includes('communication_preferences')) {
                return 'vendor_hubspot_communication_preferences';
              }

              if (normalizedId.includes('automation')) {
                return 'vendor_hubspot_automation';
              }

              if (normalizedId.includes('conversations')) {
                return 'vendor_hubspot_conversations';
              }
              return 'vendor_hubspot';
            }

            // split even more node_modules
            match = normalizedId.match(/node_modules\/(.+?)\//);
            if (match) {
              // Replace slashes in scoped packages, e.g. @hubspot/api-client → vendor_hubspot_api_client
              const packageName = match[1].replace('@', '').replace(/\//g, '_');
              return `vendor_${packageName}`;
            }

            // fallback for remaining
            return 'vendor'; // A general chunk for other modules
          }
        }
      }
      
    }   
  },
  
  server: {
    watch: {
      usePolling: true, // Use polling to detect file changes (useful on networked file systems)
      interval: 100,     // Set a custom polling interval (in ms)
    }
  }
});


