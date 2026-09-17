export interface PopupCommand {
  label?: string
  type: 'bridge.connect' | 'bridge.disconnect' | 'bridge.status'
}

export interface MessageSenderIdentity {
  id?: string
  url?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isTrustedPopupCommand(
  message: unknown,
  sender: MessageSenderIdentity,
  extensionId: string,
  popupUrl: string
): message is PopupCommand {
  return sender.id === extensionId && sender.url === popupUrl &&
    isRecord(message) &&
    Object.keys(message).every(key => key === 'type' || (key === 'label' && message.type === 'bridge.connect')) &&
    (message.label === undefined || (typeof message.label === 'string' && message.label.length <= 64)) && (
      message.type === 'bridge.connect' ||
      message.type === 'bridge.disconnect' ||
      message.type === 'bridge.status'
    )
}
