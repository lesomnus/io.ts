import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
	{
		extends: './vite.config.ts',
		test: {
			globals: true,
			environment: 'node',
		},
	},
	{
		extends: './vite.config.ts',
		test: {
			globals: true,
			browser: {
				enabled: true,
				name: 'chromium',
				provider: 'playwright',
				headless: true,
				screenshotFailures: false,
			},
		},
	},
])
