import React, { useEffect, useState } from 'react';
import { XMarkIcon, PencilSquareIcon, CheckIcon, XMarkIcon as XIcon } from '@heroicons/react/24/outline';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { HardBreak } from '@tiptap/extension-hard-break';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

interface Note {
    id: string;
    content: string;
    timestamp: string;
    edited_by?: string;
    edited_at?: string;
}

interface ExpertNotesModalProps {
    isOpen: boolean;
    onClose: () => void;
    notes: Note[];
    formatNoteText: (text: string) => string;
    isSuperuser: boolean;
    currentUserEmployeeId: number | null;
    currentUserDisplayName: string | null;
    assignedExpertId: number | null;
    getCurrentUserName: () => Promise<string>;
    onSave: (updatedNotes: Note[]) => Promise<void>;
}

const ExpertNotesModal: React.FC<ExpertNotesModalProps> = ({
    isOpen,
    onClose,
    notes,
    formatNoteText,
    isSuperuser,
    currentUserEmployeeId,
    currentUserDisplayName,
    assignedExpertId,
    getCurrentUserName,
    onSave
}) => {
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);

    // Create editor for each note (we'll create one when editing)
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                hardBreak: false, // We'll use our own HardBreak extension
            }),
            Underline,
            HardBreak,
        ],
        content: '',
        editorProps: {
            attributes: {
                class: 'prose max-w-none focus:outline-none min-h-[200px] p-4',
            },
        },
    });

    // Update editor content when editing a note
    useEffect(() => {
        if (editingNoteId && editor) {
            const note = notes.find(n => n.id === editingNoteId);
            if (note) {
                if (note.content.startsWith('<')) {
                    // Content is already HTML
                    editor.commands.setContent(note.content);
                } else {
                    // Convert plain text to HTML for editor (preserve line breaks properly)
                    // Split by double line breaks first (paragraph breaks)
                    const paragraphs = note.content.split(/\n\n+/);
                    const htmlParts: string[] = [];

                    for (const para of paragraphs) {
                        // Escape HTML entities
                        let escaped = para
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;');

                        // Convert single line breaks within paragraph to <br> tags
                        escaped = escaped.replace(/\n/g, '<br>');

                        // Wrap in paragraph tag
                        htmlParts.push(`<p>${escaped}</p>`);
                    }

                    const htmlContent = htmlParts.join('');
                    editor.commands.setContent(htmlContent || '<p></p>');
                }
            }
        }
    }, [editingNoteId, notes, editor]);

    // Check if user can edit a note
    const canEditNote = (note: Note): boolean => {
        if (isSuperuser) return true;

        // Check if current user is the assigned expert
        if (assignedExpertId !== null && currentUserEmployeeId !== null) {
            if (Number(assignedExpertId) === Number(currentUserEmployeeId)) {
                return true;
            }
        }

        // Check if current user is the one who edited/created the note
        if (note.edited_by && currentUserDisplayName) {
            if (note.edited_by.trim().toLowerCase() === currentUserDisplayName.trim().toLowerCase()) {
                return true;
            }
        }

        return false;
    };

    const handleStartEdit = (note: Note) => {
        if (!canEditNote(note)) return;
        setEditingNoteId(note.id);
        setEditedContent(note.content);
    };

    const handleCancelEdit = () => {
        setEditingNoteId(null);
        setEditedContent('');
        if (editor) {
            editor.commands.clearContent();
        }
    };

    const handleSaveEdit = async () => {
        if (!editingNoteId || !editor) return;

        setIsSaving(true);
        try {
            // Get HTML content to preserve formatting
            const htmlContent = editor.getHTML();

            // Also get plain text for fallback/display
            const textContent = editor.getText().trim();

            const currentUser = await getCurrentUserName();
            const currentTime = new Date().toLocaleString();

            // Store HTML content to preserve formatting
            const updatedNotes = notes.map(note =>
                note.id === editingNoteId
                    ? {
                        ...note,
                        content: htmlContent, // Store HTML to preserve formatting
                        edited_by: currentUser,
                        edited_at: currentTime
                    }
                    : note
            );

            await onSave(updatedNotes);
            setEditingNoteId(null);
            setEditedContent('');
            if (editor) {
                editor.commands.clearContent();
            }
            toast.success('Note saved successfully');
        } catch (error) {
            console.error('Error saving note:', error);
            toast.error('Failed to save note');
        } finally {
            setIsSaving(false);
        }
    };

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                if (editingNoteId) {
                    handleCancelEdit();
                } else {
                    onClose();
                }
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose, editingNoteId]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onClick={onClose}
        >
            {/* Backdrop with fade-in animation */}
            <div
                className="absolute inset-0 bg-black transition-opacity duration-300 ease-out"
                style={{ opacity: 0.5 }}
            />

            {/* Modal content with slide-up and fade-in animation */}
            <div
                className="relative bg-white w-full h-full overflow-hidden flex flex-col"
                style={{
                    animation: 'slideUpFadeIn 0.3s ease-out forwards'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <style>{`
          @keyframes slideUpFadeIn {
            from {
              opacity: 0;
              transform: translateY(20px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>

                {/* Header */}
                <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between px-6 py-4">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900">Expert Notes</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="btn btn-ghost btn-circle hover:bg-gray-100"
                            aria-label="Close modal"
                        >
                            <XMarkIcon className="w-6 h-6 text-gray-600" />
                        </button>
                    </div>
                </div>

                {/* Formatting Toolbar - Fixed at top when editing */}
                {editingNoteId && editor && (
                    <div className="sticky top-[80px] z-10 flex flex-wrap gap-2 items-center px-6 py-3 border-b border-gray-200 bg-gray-50 shadow-sm">
                        <button
                            className={`btn btn-sm ${editor.isActive('bold') ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            title="Bold"
                        >
                            <b className="text-base font-bold">B</b>
                        </button>
                        <button
                            className={`btn btn-sm ${editor.isActive('italic') ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                            title="Italic"
                        >
                            <i className="text-base italic">I</i>
                        </button>
                        <button
                            className={`btn btn-sm ${editor.isActive('underline') ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => editor.chain().focus().toggleUnderline().run()}
                            title="Underline"
                        >
                            <u className="text-base underline">U</u>
                        </button>
                        <button
                            className={`btn btn-sm ${editor.isActive('strike') ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => editor.chain().focus().toggleStrike().run()}
                            title="Strikethrough"
                        >
                            <s className="text-base line-through">S</s>
                        </button>
                        <div className="divider divider-horizontal"></div>
                        <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => editor.chain().focus().setParagraph().run()}
                            title="Paragraph"
                        >
                            P
                        </button>
                        <button
                            className={`btn btn-sm ${editor.isActive('heading', { level: 1 }) ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                            title="Heading 1"
                        >
                            H1
                        </button>
                        <button
                            className={`btn btn-sm ${editor.isActive('heading', { level: 2 }) ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                            title="Heading 2"
                        >
                            H2
                        </button>
                        <div className="divider divider-horizontal"></div>
                        <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => editor.chain().focus().undo().run()}
                            title="Undo"
                        >
                            ↶
                        </button>
                        <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => editor.chain().focus().redo().run()}
                            title="Redo"
                        >
                            ↷
                        </button>
                        <div className="flex-1"></div>
                        <button
                            className="btn btn-sm btn-ghost hover:bg-red-50"
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                        >
                            <XIcon className="w-4 h-4 text-red-600" />
                            Cancel
                        </button>
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={handleSaveEdit}
                            disabled={isSaving}
                            style={{ backgroundColor: '#3b28c7', color: 'white' }}
                        >
                            {isSaving ? (
                                <>
                                    <span className="loading loading-spinner loading-xs"></span>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <CheckIcon className="w-4 h-4" />
                                    Save
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-8 md:px-12 lg:px-16 xl:px-20 py-8">
                    {notes.length > 0 ? (
                        <div className="max-w-7xl mx-auto">
                            {notes.map((note, index) => (
                                <div key={note.id}>
                                    {editingNoteId === note.id && editor ? (
                                        // Edit mode with editor
                                        <div className="border-2 border-purple-300 rounded-lg bg-white">
                                            <EditorContent editor={editor} />
                                        </div>
                                    ) : (
                                        // View mode
                                        <>
                                            <div className="prose max-w-none">
                                                {note.content.startsWith('<') ? (
                                                    // Render HTML content
                                                    <div
                                                        className="text-base text-gray-800 leading-relaxed"
                                                        dangerouslySetInnerHTML={{ __html: note.content }}
                                                    />
                                                ) : (
                                                    // Render plain text
                                                    <p className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                                        {formatNoteText(note.content)}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Edit button and footer */}
                                            <div className="mt-4 mb-8 flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                                    {note.edited_by && (
                                                        <>
                                                            <span className="font-medium">Edited by {note.edited_by}</span>
                                                            <span>•</span>
                                                        </>
                                                    )}
                                                    <span>{note.timestamp}</span>
                                                    {note.edited_at && note.edited_at !== note.timestamp && (
                                                        <>
                                                            <span>•</span>
                                                            <span>Updated: {note.edited_at}</span>
                                                        </>
                                                    )}
                                                </div>
                                                {canEditNote(note) && (
                                                    <button
                                                        onClick={() => handleStartEdit(note)}
                                                        className="btn btn-ghost btn-sm"
                                                        title="Edit note"
                                                    >
                                                        <PencilSquareIcon className="w-4 h-4" />
                                                        Edit
                                                    </button>
                                                )}
                                            </div>
                                        </>
                                    )}

                                    {/* Separator between notes */}
                                    {index < notes.length - 1 && editingNoteId !== note.id && (
                                        <div className="border-b border-gray-200 my-8"></div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <p className="text-xl font-medium text-gray-500 mb-2">No expert notes yet</p>
                                <p className="text-base text-gray-400">Expert opinions and assessments will appear here</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExpertNotesModal;
