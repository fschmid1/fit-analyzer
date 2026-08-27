# Trainer message content stays text; attachments are referenced, not embedded

`TrainerMessage.content` remains a plain string; attachments are held as an optional list of lightweight refs (`id`, `kind`, dimensions, media type) on the message — never inline in content, never a parts-based content model.

Why: the chat contract is text-first with a single attachment kind (image), so a parts array would ripple through the renderer, compaction, and token estimates for no benefit, while refs keep persistence a JSON column (mirroring `tool_calls`) and make provider payload building a simple "history as-is, images riding with their messages" travel rule. A parts model can still be adopted later if a second content kind ever justifies it.