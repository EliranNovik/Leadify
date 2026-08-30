import { Node, mergeAttributes } from '@tiptap/core';
import { contractLinkTitle, RMQ_LOGO_URL } from '../../lib/leadContractLink';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    contractLinkPreview: {
      insertContractLinkPreview: (attrs: {
        href: string;
        signed?: boolean;
        leadNumber?: string | null;
      }) => ReturnType;
    };
  }
}

export const ContractLinkPreview = Node.create({
  name: 'contractLinkPreview',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-href') || element.querySelector('a')?.getAttribute('href') || '',
      },
      signed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-signed') === '1',
      },
      leadNumber: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-lead-number') || '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-contract-preview]' }, { tag: 'table[data-contract-preview]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const href = String(HTMLAttributes.href || '');
    const signed = Boolean(HTMLAttributes.signed);
    const leadNumber = String(HTMLAttributes.leadNumber || '');
    const cta = signed ? 'View contract' : 'Open contract';
    return [
      'div',
      mergeAttributes({
        'data-contract-preview': '1',
        'data-href': href,
        'data-signed': signed ? '1' : '0',
        'data-lead-number': leadNumber,
        class: 'contract-link-preview-card',
      }),
      [
        'div',
        { class: 'contract-link-preview-header' },
        ['div', { class: 'contract-link-preview-title' }, contractLinkTitle(leadNumber)],
        [
          'img',
          {
            class: 'contract-link-preview-logo',
            src: RMQ_LOGO_URL,
            width: '64',
            height: '64',
            alt: 'RMQ',
          },
        ],
      ],
      [
        'a',
        {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'contract-link-preview-btn',
        },
        cta,
      ],
    ];
  },

  addCommands() {
    return {
      insertContractLinkPreview:
        (attrs) =>
        ({ editor, tr, dispatch }) => {
          const type = editor.schema.nodes.contractLinkPreview;
          if (!type) return false;
          const node = type.create({
            href: String(attrs.href || ''),
            signed: Boolean(attrs.signed),
            leadNumber: String(attrs.leadNumber || ''),
          });
          if (dispatch) {
            const { $from } = tr.selection;
            const pos = $from.depth === 0 ? $from.pos : $from.after(1);
            tr.insert(Math.min(Math.max(pos, 0), tr.doc.content.size), node);
          }
          return true;
        },
    };
  },
});
