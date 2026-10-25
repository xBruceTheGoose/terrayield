import { NextResponse } from 'next/server'
import { ACTIONS_CORS_HEADERS } from '@solana/actions'

const ACTION_HEADERS = {
  ...ACTIONS_CORS_HEADERS,
  'x-action-version': '2.1.3',
  'x-blockchain-ids': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1,solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
}

/**
 * GET /actions.json
 * Implements the Solana Actions domain specification.
 * Tells wallets and Blink clients (Dialect, Twitter, etc.) which URLs support Solana Actions.
 */
export async function GET() {
  const payload = {
    rules: [
      {
        pathPattern: '/',
        apiPath: '/api/actions/terrayield',
      },
      {
        pathPattern: '/terrayield',
        apiPath: '/api/actions/terrayield',
      },
      {
        pathPattern: '/api/actions/terrayield',
        apiPath: '/api/actions/terrayield',
      },
      {
        pathPattern: '/api/actions/**',
        apiPath: '/api/actions/**',
      },
      {
        pathPattern: '/**',
        apiPath: '/api/actions/terrayield',
      },
    ],
  }

  return NextResponse.json(payload, {
    headers: ACTION_HEADERS,
  })
}

export async function OPTIONS() {
  return new Response(null, {
    headers: ACTION_HEADERS,
  })
}
