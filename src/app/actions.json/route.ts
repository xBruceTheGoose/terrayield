import { NextResponse } from 'next/server'
import { ACTIONS_CORS_HEADERS } from '@solana/actions'

/**
 * GET /actions.json
 * Implements the Solana Actions domain specification.
 * Tells wallets and Blink clients (Dialect, Twitter, etc.) which URLs support Solana Actions.
 */
export async function GET() {
  const payload = {
    rules: [
      {
        pathPattern: '/*',
        apiPath: '/api/actions/*',
      },
      {
        pathPattern: '/api/actions/**',
        apiPath: '/api/actions/**',
      },
    ],
  }

  return NextResponse.json(payload, {
    headers: ACTIONS_CORS_HEADERS,
  })
}

export async function OPTIONS() {
  return new Response(null, {
    headers: ACTIONS_CORS_HEADERS,
  })
}
