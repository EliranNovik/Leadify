# Styling the AI chat window

The RMQ AI chat is `src/components/AIChatWindow.tsx`. Almost all of its look is a `<style>` block inside that component, scoped by the classes on the panel. Global CSS only paints the phone notch and home-indicator strip while the chat is open.

## Where to edit

| What | Where |
| --- | --- |
| Colors, bubbles, cards, composer chrome, motion | `<style>` in `AIChatWindow.tsx`, on the root `.ai-chat-panel` |
| Phone safe-area strip (notch and home indicator) | `src/index.css`, rules for `html.rmq-ai-chat-dark` and `html.rmq-ai-chat-light` |
| Panel size and position | Constants near the top of `AIChatWindow.tsx` (`MIN_PANEL_WIDTH`, `MIN_PANEL_HEIGHT`, `PANEL_EDGE_MARGIN`) |

DaisyUI and Tailwind classes on the markup set layout (flex, padding, rounded corners). Color that must follow light and dark mode belongs in the CSS variables below, not in a one-off Tailwind color class.

## Light and dark

The panel root gets one theme class:

- `.ai-drawer-dark` — default
- `.ai-drawer-light`

The choice is stored in `localStorage` under `rmqAiDrawerTheme` (`dark` or `light`). A missing value means dark.

On a phone, opening the chat also sets `html.rmq-ai-chat-dark` or `html.rmq-ai-chat-light` and paints `html`, `body`, and `#root` so the area outside the panel matches the chat. Those colors are duplicated:

| Token | Dark | Light |
| --- | --- | --- |
| `AI_CHROME_DARK` / `AI_CHROME_LIGHT` in `AIChatWindow.tsx` | `#121316` | `#f9fafb` |
| `--ai-bg` in the same file | `#121316` | `#f9fafb` |
| `src/index.css` safe-area rules | `#121316` | `#f9fafb` |

Change all three together. If only `--ai-bg` moves, the notch and the home-indicator strip stay on the old color.

## Color tokens

Set these on `.ai-drawer-light` and `.ai-drawer-dark`. Components read them with `var(--ai-…)`.

| Variable | Use |
| --- | --- |
| `--ai-bg` | Panel background |
| `--ai-bg-raised` | Raised surfaces |
| `--ai-bg-overlay` | Hover and overlay chips |
| `--ai-bg-input` | Composer field |
| `--ai-border` | Hairline borders |
| `--ai-text` | Primary text |
| `--ai-text-muted` | Secondary text, kicker labels |
| `--ai-bubble-user` | User bubble fill. A `linear-gradient(...)` is valid. |
| `--ai-bubble-user-text` | User bubble text |
| `--ai-bubble-ai` | Reserved assistant fill. The assistant bubble itself is transparent. |
| `--ai-bubble-ai-text` | Assistant text |
| `--ai-send` | Send button fill |
| `--ai-send-from`, `--ai-send-to` | Gradient stops used by the send button and the “saved source” icon |
| `--ai-header-bg`, `--ai-header-border` | Header glass |

A new accent that should follow the theme: add a variable on both `.ai-drawer-light` and `.ai-drawer-dark`, then use `var(--ai-your-name)` in the rule. A color that is the same in both themes can be a plain hex on the shared class.

## Panel shape

The root is `.ai-chat-panel`. Extra classes change the frame:

| Class | When |
| --- | --- |
| `.ai-drawer-enter` + `.ai-drawer-enter-float` | Floating panel, slides in |
| `.ai-drawer-enter` + `.ai-drawer-enter-sheet` | Docked sheet, slides in from the right |
| `.ai-drawer-fullpage` | Full screen, or any phone. Shadow and left border are removed. |
| `.ai-drawer-moving` | User is dragging or resizing. Transitions are off. |

Desktop floating corners are `1.5rem`. Full page and phone are square (`borderRadius: 0` on the panel `style`). Docked width is `max-w-2xl`, or `max-w-5xl` while history is open. Phone is `inset-0` and `100dvh`.

Saved position and size live in `rmqAiDrawerPos` and `rmqAiDrawerSize`. Minimums are 380×420.

## Surfaces

| Class | What it is |
| --- | --- |
| `.ai-glass` | Main column. Background is `--ai-bg`. |
| `.ai-bubble-user` | User message. Gradient, white text, large corner radius, bottom-right radius `2rem`. |
| `.ai-bubble-assistant` | Assistant message. Transparent, no border. Text color is `--ai-bubble-ai-text`. |
| `.ai-meeting-card` | Meeting card inside an answer. Light `#ffffff`, dark `#32343a`. |
| `.ai-drive-doc` | Open Drive file chip above the composer. |
| `.ai-drive-doc-ask` | Pill on that chip. Light text `#3b28c7`. |
| `.ai-sources-box` | Web sources under an answer. |
| `.ai-welcome-home`, `.ai-welcome-title`, `.ai-welcome-card`, `.ai-welcome-ask` | Empty-state home. |
| `.ai-plus-menu`, `.ai-plus-item` | Attach / plus menu. |
| `.ai-send-btn` | Send. Fill is `--ai-send`. |
| `.ai-composer-btn` | Round composer buttons. |
| `.ai-input-backdrop` | Blur behind the composer. |
| `.ai-thinking` | “Working” row: ring, dots, label, site icons. |
| `.ai-history-overlay`, `.ai-history-backdrop` | History drawer. |
| `.ai-messages-scroll` | Message list. Scrollbar is styled here. |
| `.ai-chat-link`, `.chat-lead-number-link` | Links inside an answer. Assistant links are `#0284c7`, hover `#0ea5e9`. |

Assistant cards (meetings, sources, drive) are not on the bubble variables. Their light and dark fills are separate rules: `.ai-drawer-light .ai-meeting-card` and `.ai-drawer-dark .ai-meeting-card`, and the same pattern for `.ai-drive-doc` and `.ai-sources-box`.

## Type

Message text is forced:

- Desktop: `0.9375rem` / line-height `1.6` on `.ai-bubble-user`, `.ai-bubble-assistant`, `.ai-chat-msg-text`, and their `.prose` children.
- Phone (`max-width: 768px`): `1.25rem` / line-height `1.65`.

Both rules use `!important`. A Tailwind `text-sm` on a message will not win. Change those two blocks in the `<style>` tag.

User bubble copy is white through `.ai-bubble-user .prose` and `--ai-bubble-user-text`. Assistant copy uses `--ai-bubble-ai-text`.

## Changing a color

1. Open the `<style>` block in `AIChatWindow.tsx` and find `.ai-drawer-light` and `.ai-drawer-dark`.
2. Change the variable on both themes.
3. If the value is `--ai-bg`, also update `AI_CHROME_DARK` or `AI_CHROME_LIGHT` and the matching block in `src/index.css`.
4. Reload the chat. The theme class is on the panel, so a refresh is enough. No Tailwind rebuild is required for rules inside that `<style>` tag.

Example: a flatter user bubble in both themes.

```css
.ai-drawer-light {
  --ai-bubble-user: #4f46e5;
}
.ai-drawer-dark {
  --ai-bubble-user: #6d28d9;
}
```

## What to leave alone

- Do not style the assistant bubble with a filled card unless you also remove `background: transparent` on `.ai-bubble-assistant`. The fill variable `--ai-bubble-ai` is unused by that rule today.
- Do not add a second global stylesheet for the same classes. The `<style>` block is injected with the panel and is the source of truth.
- Open Finance and payment pages are unrelated. This file is only the CRM AI drawer.
