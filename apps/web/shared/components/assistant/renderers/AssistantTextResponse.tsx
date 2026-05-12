interface Props {
  content: string;
}

/**
 * AssistantTextResponse - Renders plain text responses from the assistant
 *
 * @param content - The text content to display
 */
export function AssistantTextResponse({ content }: Props) {
  return <p className="text-sm whitespace-pre-wrap">{content}</p>;
}
