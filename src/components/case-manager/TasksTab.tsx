import React, { useState, useEffect } from 'react';
import { 
  ClockIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon,
  PlusIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';

interface HandlerLead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  category?: string;
  stage: string;
  handler_stage?: string;
  created_at: string;
  balance?: number;
  balance_currency?: string;
  onedrive_folder_link?: string;
  expert?: string;
  handler?: string;
  closer?: string;
  scheduler?: string;
  manager?: string;
}

interface HandlerTask {
  id: string;
  lead_id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  assigned_to?: string;
  created_by: string;
  due_date?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  tags?: string[];
  estimated_hours?: number;
  actual_hours?: number;
  lead?: {
    name: string;
    lead_number: string;
  };
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

// Tasks Tab Component with full CRUD functionality
const TasksTab: React.FC<HandlerTabProps> = ({ leads, refreshLeads }) => {
    const [tasks, setTasks] = useState<HandlerTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingTask, setEditingTask] = useState<HandlerTask | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterPriority, setFilterPriority] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
  
    // New task form state
    const [newTask, setNewTask] = useState({
      title: '',
      description: '',
      priority: 'medium' as const,
      lead_id: leads.length === 1 ? leads[0].id : '',
      due_date: '',
      estimated_hours: '',
      tags: ''
    });
  
    // Fetch tasks from database - filter by current lead if in single case view
    const fetchTasks = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('handler_tasks')
          .select(`
            *,
            lead:leads(name, lead_number)
          `)
          .order('created_at', { ascending: false });
        
        // If we're in single case view (only one lead), filter by that lead
        if (leads.length === 1) {
          query = query.eq('lead_id', leads[0].id);
        }
        
        const { data, error } = await query;
        
        if (error) {
          toast.error('Error fetching tasks: ' + error.message);
        } else if (data) {
          setTasks(data);
        }
      } catch (err) {
        toast.error('Failed to fetch tasks');
        console.error('Error fetching tasks:', err);
      } finally {
        setLoading(false);
      }
    };
  
    useEffect(() => {
      fetchTasks();
    }, []);
  
    // Create new task
    const createTask = async () => {
      if (!newTask.title.trim()) {
        toast.error('Title is required');
        return;
      }
      
      // Automatically set the lead_id to the current lead if in single case view
      const leadId = leads.length === 1 ? leads[0].id : newTask.lead_id;
      if (!leadId) {
        toast.error('Lead is required');
        return;
      }
  
      try {
        const taskData = {
          ...newTask,
          lead_id: leadId, // Use the automatically determined lead_id
          created_by: 'current_user', // Replace with actual user
          assigned_to: 'current_user', // Replace with actual user
          tags: newTask.tags ? newTask.tags.split(',').map(t => t.trim()) : [],
          estimated_hours: newTask.estimated_hours ? parseInt(newTask.estimated_hours) : null,
          due_date: newTask.due_date || null
        };
  
        const { error } = await supabase
          .from('handler_tasks')
          .insert(taskData);
        
        if (error) {
          toast.error('Error creating task: ' + error.message);
        } else {
          toast.success('Task created successfully');
          setShowCreateModal(false);
          setNewTask({
            title: '',
            description: '',
            priority: 'medium',
            lead_id: leads.length === 1 ? leads[0].id : '',
            due_date: '',
            estimated_hours: '',
            tags: ''
          });
          await fetchTasks();
        }
      } catch (err) {
        toast.error('Failed to create task');
        console.error('Error creating task:', err);
      }
    };
  
    // Update task status
    const updateTaskStatus = async (taskId: string, status: string) => {
      try {
        const updateData: any = { status };
        if (status === 'completed') {
          updateData.completed_at = new Date().toISOString();
        }
  
        const { error } = await supabase
          .from('handler_tasks')
          .update(updateData)
          .eq('id', taskId);
        
        if (error) {
          toast.error('Error updating task: ' + error.message);
        } else {
          toast.success('Task updated successfully');
          await fetchTasks();
        }
      } catch (err) {
        toast.error('Failed to update task');
      }
    };
  
    // Update task
    const updateTask = async () => {
      if (!editingTask) return;
  
      try {
        const { error } = await supabase
          .from('handler_tasks')
          .update({
            title: editingTask.title,
            description: editingTask.description,
            priority: editingTask.priority,
            due_date: editingTask.due_date,
            estimated_hours: editingTask.estimated_hours
          })
          .eq('id', editingTask.id);
        
        if (error) {
          toast.error('Error updating task: ' + error.message);
        } else {
          toast.success('Task updated successfully');
          setEditingTask(null);
          await fetchTasks();
        }
      } catch (err) {
        toast.error('Failed to update task');
      }
    };
  
    // Delete task
    const deleteTask = async (taskId: string) => {
      if (!confirm('Are you sure you want to delete this task?')) return;
  
      try {
        const { error } = await supabase
          .from('handler_tasks')
          .delete()
          .eq('id', taskId);
        
        if (error) {
          toast.error('Error deleting task: ' + error.message);
        } else {
          toast.success('Task deleted successfully');
          await fetchTasks();
        }
      } catch (err) {
        toast.error('Failed to delete task');
      }
    };
  
    // Filter tasks
    const filteredTasks = tasks.filter(task => {
      const matchesStatus = filterStatus === 'all' || task.status === filterStatus;
      const matchesPriority = filterPriority === 'all' || task.priority === filterPriority;
      const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           task.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           task.lead?.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesStatus && matchesPriority && matchesSearch;
    });
  
    // Get priority badge color
    const getPriorityBadgeColor = (priority: string) => {
      switch (priority) {
        case 'low': return 'badge-neutral';
        case 'medium': return 'badge-warning';
        case 'high': return 'badge-error';
        case 'urgent': return 'badge-error badge-outline';
        default: return 'badge-neutral';
      }
    };
  
    if (loading) {
      return (
        <div className="text-center py-16 px-8">
          <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
          <p className="text-lg text-gray-600">Loading tasks...</p>
        </div>
      );
    }
  
    return (
      <div className="w-full px-8">
        {/* Header with filters and create button */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Task Management</h3>
            <p className="text-gray-600">Manage tasks for all handler-assigned cases</p>
          </div>
          <button 
            className="btn btn-primary gap-2"
            onClick={() => setShowCreateModal(true)}
          >
            <PlusIcon className="w-4 h-4" />
            Create Task
          </button>
        </div>
  
        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 p-6 mb-8">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search tasks..."
              className="input input-bordered w-full pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select 
            className="select select-bordered"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select 
            className="select select-bordered"
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
          >
            <option value="all">All Priority</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
  
        {/* Tasks Grid */}
        {filteredTasks.length === 0 ? (
          <div className="text-center py-16 px-8 text-gray-500">
            <ClockIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-1">No tasks found</p>
            <p className="text-base">Create your first task to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTasks.map((task) => (
              <div key={task.id} className="bg-white rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group">
                <div className="card-body p-5">
                  {/* Top Row: Status and Priority */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex gap-6">
                      <span className={`badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none`}>
                        {task.status.replace('_', ' ')}
                      </span>
                      <span className="badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">
                        {task.priority}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white"
                        onClick={() => setEditingTask(task)}
                      >
                        <PencilIcon className="w-5 h-5" />
                      </button>
                      <button 
                        className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white"
                        onClick={() => deleteTask(task.id)}
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
  
                  {/* Title and Due Date Row */}
                  <div className="flex justify-between items-start mb-3">
                    <h2 className="card-title text-xl font-bold group-hover:text-purple-600 transition-colors">
                      {task.title}
                    </h2>
                    {task.due_date && (
                      <div className="text-right">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">Due Date</span>
                        <p className="text-sm font-medium">{task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}</p>
                      </div>
                    )}
                  </div>
  
                  {/* Description in Gray Box */}
                  {task.description && (
                    <div className="bg-gray-100 rounded-lg p-3 mb-4">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Description</span>
                      <p className="text-sm text-gray-700 line-clamp-3">{task.description}</p>
                    </div>
                  )}
  
                  {/* Action Buttons */}
                  <div className="mt-auto pt-4 border-t border-base-200/50">
                    <div className="flex gap-2">
                      {task.status !== 'completed' && (
                        <button 
                          className="btn btn-sm text-white border-none flex-1"
                          style={{ backgroundColor: '#411CCF' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'linear-gradient(to top right, #EC4899, #A855F7, #9333EA)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#411CCF'}
                          onClick={() => updateTaskStatus(task.id, 'completed')}
                        >
                          Complete
                        </button>
                      )}
                      {task.status === 'completed' && (
                        <button 
                          className="btn btn-sm btn-outline flex-1"
                          onClick={() => updateTaskStatus(task.id, 'in_progress')}
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
  
        {/* Create Task Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Create New Task</h3>
                <button 
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
  
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newTask.title}
                    onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter task title..."
                  />
                </div>
  
                {leads.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lead *</label>
                    <select
                      className="select select-bordered w-full"
                      value={newTask.lead_id}
                      onChange={(e) => setNewTask(prev => ({ ...prev, lead_id: e.target.value }))}
                    >
                      <option value="">Select a lead...</option>
                      {leads.map(lead => (
                        <option key={lead.id} value={lead.id}>
                          {lead.name} - #{lead.lead_number}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-24 resize-none"
                    value={newTask.description}
                    onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Enter task description..."
                  />
                </div>
  
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      className="select select-bordered w-full"
                      value={newTask.priority}
                      onChange={(e) => setNewTask(prev => ({ ...prev, priority: e.target.value as any }))}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Est. Hours</label>
                    <input
                      type="number"
                      className="input input-bordered w-full"
                      value={newTask.estimated_hours}
                      onChange={(e) => setNewTask(prev => ({ ...prev, estimated_hours: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={newTask.due_date}
                    onChange={(e) => setNewTask(prev => ({ ...prev, due_date: e.target.value }))}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newTask.tags}
                    onChange={(e) => setNewTask(prev => ({ ...prev, tags: e.target.value }))}
                    placeholder="documents, urgent, review (comma separated)"
                  />
                </div>
              </div>
  
              <div className="flex gap-3 mt-6">
                <button 
                  className="btn btn-outline flex-1"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary flex-1"
                  onClick={createTask}
                >
                  Create Task
                </button>
              </div>
            </div>
          </div>
        )}
  
        {/* Edit Task Modal */}
        {editingTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Edit Task</h3>
                <button 
                  onClick={() => setEditingTask(null)}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
  
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editingTask.title}
                    onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, title: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-24 resize-none"
                    value={editingTask.description || ''}
                    onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, description: e.target.value }) : null)}
                  />
                </div>
  
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      className="select select-bordered w-full"
                      value={editingTask.priority}
                      onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, priority: e.target.value as any }) : null)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Est. Hours</label>
                    <input
                      type="number"
                      className="input input-bordered w-full"
                      value={editingTask.estimated_hours || ''}
                      onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, estimated_hours: parseInt(e.target.value) || undefined }) : null)}
                    />
                  </div>
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={editingTask.due_date ? editingTask.due_date.split('T')[0] : ''}
                    onChange={(e) => setEditingTask(prev => prev ? ({ ...prev, due_date: e.target.value }) : null)}
                  />
                </div>
              </div>
  
              <div className="flex gap-3 mt-6">
                <button 
                  className="btn btn-outline flex-1"
                  onClick={() => setEditingTask(null)}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary flex-1"
                  onClick={updateTask}
                >
                  Update Task
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

export default TasksTab; 