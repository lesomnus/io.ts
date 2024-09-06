import { resolve } from 'node:path'

import dts from 'vite-plugin-dts'
import inspect from 'vite-plugin-inspect'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		inspect({ build: true }),
		tsconfigPaths(),
		dts({
			exclude: ['vite.config.ts', '**/*.test.ts'],
		}),
	],
	build: {
		minify: false,
		lib: {
			entry: {
				main: resolve(import.meta.dirname, 'src/index.ts'),
				path: resolve(import.meta.dirname, 'src/path/index.ts'),
				fs: resolve(import.meta.dirname, 'src/fs/index.ts'),
			},
			formats: ['es', 'cjs'],
		},
	},
	server: {
		host: '0.0.0.0',
	},
	test: {
		coverage: {
			enabled: true,
			provider: 'istanbul',
			reporter: ['html', 'lcov'],
		},
	},
})
