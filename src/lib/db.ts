import { PrismaClient } from '@prisma/client'

// Explicitly load .env so Prisma can find DATABASE_URL even when the
// app is started outside Next.js's built-in env loading (e.g. on
// Windows when running `next dev` directly without the setup script,
// or in production where .env might not be auto-loaded). dotenv is a
// dependency of Prisma so it's always available.
import { config } from 'dotenv'
config()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db