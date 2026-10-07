/** A photo URL is accepted server-side only if it is in the sender's own chat-photos folder. */
export function isOwnChatPhoto(url: unknown, userId: string): url is string {
  return typeof url === 'string'
    && url.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-photos/${userId}/`)
}
