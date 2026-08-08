import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function requireEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

export function getAdminServices() {
  const app = getApps()[0] ?? initializeApp({
    credential: cert({
      projectId: requireEnvironment('FIREBASE_PROJECT_ID'),
      clientEmail: requireEnvironment('FIREBASE_CLIENT_EMAIL'),
      privateKey: requireEnvironment('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  })

  return { auth: getAuth(app), db: getFirestore(app) }
}
