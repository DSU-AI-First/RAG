import ChatView from "@/components/chat-view";

export default async function ChatPage({ params }: { params: Promise<{ chatid: string }> }) {
  const { chatid } = await params;
  return <ChatView key={chatid} chatid={chatid} />;
}
