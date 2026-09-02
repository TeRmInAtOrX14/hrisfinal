import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Plus,
  Percent,
  X,
  Loader2,
  DollarSign,
  Trash2,
  Search,
  Filter,
  Award,
  Zap,
  Info,
  ShieldAlert,
  Save
} from 'lucide-react';
import api, { session, apiError } from '../utils/api';
import toast from 'react-hot-toast';
import { MONTH_NAMES, payrollYears } from '../utils/format';

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // overview, dashboard, commission_builder, simulator
  const [selectedSdrIds, setSelectedSdrIds] = useState([]);

  // Selected Campaign details for Dashboard/Commission tabs
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // Admin performance entry on the dashboard tab. Admins may log for any
  // member of any campaign, for any month (e.g. last month's numbers before
  // running that payroll).
  const [perfMonth, setPerfMonth] = useState(new Date().getMonth() + 1);
  const [perfYear, setPerfYear] = useState(new Date().getFullYear());
  const [perfDrafts, setPerfDrafts] = useState({}); // { [employeeId]: { meetingsBooked, showups, noShows, cancelledMeetings } }
  const [perfSavingId, setPerfSavingId] = useState(null);

  // Commission Builder state
  const [structures, setStructures] = useState([]);
  const [structuresLoading, setStructuresLoading] = useState(false);
  const [selectedStructure, setSelectedStructure] = useState(null);
  const [structureModalOpen, setStructureModalOpen] = useState(false);
  const [structureName, setStructureName] = useState('');
  const [slabs, setSlabs] = useState([]);

  // Simulator state
  const [simShowups, setSimShowups] = useState('15');
  const [simResults, setSimResults] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modals
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [editCampaignOpen, setEditCampaignOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRole, setAssignRole] = useState('sdr');
  const [assignEmployeeId, setAssignEmployeeId] = useState('');

  const currentUser = session.user || { role: 'Employee' };
  // Only Admin, CEO, COO can modify Campaigns or commissions. Team Lead is view-only supervisor.
  const isAdmin = ['Admin', 'CEO', 'COO'].includes(currentUser.role);
  const _isTeamLead = currentUser.role === 'Team Lead';

  const { register, handleSubmit, reset, setValue } = useForm();

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/campaigns');
      setCampaigns(res.data);

      if (res.data.length > 0 && !selectedCampaignId) {
        setSelectedCampaignId(res.data[0].id);
      }

      // If Admin or Team Lead, fetch employee lists for assignments
      if (isAdmin) {
        const empRes = await api.get('/employees?status=active');
        setEmployees(empRes.data);
      }
    } catch (e) {
      toast.error(apiError(e, 'Failed to load campaigns.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
    // Intentional mount-once fetch. These callbacks are recreated on every
    // render, so listing them here would re-fetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch performance dashboard data when selected campaign or active tab changes
  useEffect(() => {
    if (selectedCampaignId && activeTab === 'dashboard') {
      // A different campaign or period: drop any typed-but-unsaved drafts so
      // the editor reseeds from that period's logged figures.
      setPerfDrafts({});
      fetchDashboard();
    }
    if (selectedCampaignId && activeTab === 'commission_builder') {
      fetchStructures();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, activeTab, perfMonth, perfYear]);

  // Seed the performance editor from what is logged. Merge rather than
  // replace: saving one row refetches the dashboard, and a wholesale reseed
  // would discard unsaved edits typed into other rows.
  useEffect(() => {
    if (!dashboardData) return;
    const fresh = {};
    for (const row of dashboardData.leaderboard || []) {
      fresh[row.employeeId] = {
        meetingsBooked: row.meetingsBooked ?? 0,
        showups: row.showups ?? 0,
        noShows: row.noShows ?? 0,
        cancelledMeetings: row.cancelledMeetings ?? 0,
      };
    }
    const leadId = dashboardData.campaign?.teamLeadId;
    if (leadId) {
      fresh[leadId] = {
        meetingsBooked: dashboardData.campaign?.teamLeadPerformance?.meetingsBooked ?? 0,
        showups: dashboardData.campaign?.teamLeadPerformance?.showups ?? 0,
        noShows: 0,
        cancelledMeetings: 0,
      };
    }
    setPerfDrafts((prev) => {
      const next = {};
      for (const id of Object.keys(fresh)) next[id] = prev[id] ?? fresh[id];
      return next;
    });
  }, [dashboardData]);

  const fetchDashboard = async () => {
    try {
      setDashboardLoading(true);
      const res = await api.get(`/campaigns/${selectedCampaignId}/dashboard?month=${perfMonth}&year=${perfYear}`);
      setDashboardData(res.data);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load campaign performance.'));
    } finally {
      setDashboardLoading(false);
    }
  };

  const saveAdminPerformance = async (employeeId) => {
    if (!selectedCampaignId) return;
    const draft = perfDrafts[employeeId] || {};
    // Whole numbers only — the API rejects decimals for counts.
    const toCount = (v) => Math.trunc(Number(v)) || 0;
    const meetingsBooked = toCount(draft.meetingsBooked);
    const showups = toCount(draft.showups);
    const noShows = toCount(draft.noShows);
    const cancelledMeetings = toCount(draft.cancelledMeetings);
    if ([meetingsBooked, showups, noShows, cancelledMeetings].some((n) => n < 0)) {
      toast.error('Metrics cannot be negative.');
      return;
    }
    if (showups > meetingsBooked) {
      toast.error('Show-ups cannot exceed meetings booked.');
      return;
    }
    const isLead = employeeId === dashboardData?.campaign?.teamLeadId;
    try {
      setPerfSavingId(employeeId);
      await api.post('/campaigns/performance', {
        employeeId,
        campaignId: selectedCampaignId,
        month: perfMonth,
        year: perfYear,
        meetingsBooked,
        showups,
        // The lead row only exposes the two headline figures; leave their
        // stored no-show / cancelled counts untouched rather than zeroing them.
        ...(isLead ? {} : { noShows, cancelledMeetings }),
      });
      toast.success('Performance saved.');
      await fetchDashboard();
    } catch (err) {
      toast.error(apiError(err, 'Could not save performance.'));
    } finally {
      setPerfSavingId(null);
    }
  };

  const perfInput = (employeeId, field, label, cls = '') => (
    <input
      type="number"
      min="0"
      aria-label={label}
      value={perfDrafts[employeeId]?.[field] ?? ''}
      onChange={(e) =>
        setPerfDrafts((d) => ({ ...d, [employeeId]: { ...d[employeeId], [field]: e.target.value } }))
      }
      className={`w-16 px-2 py-1 rounded-lg bg-brand-bg border border-brand-border text-xs text-center focus:outline-none focus:border-brand-blue tabular-nums ${cls}`}
    />
  );

  const fetchStructures = async () => {
    try {
      setStructuresLoading(true);
      const res = await api.get(`/campaigns/${selectedCampaignId}/structures`);
      setStructures(res.data);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load commission structures.'));
    } finally {
      setStructuresLoading(false);
    }
  };

  const handleCreateCampaign = async (data) => {
    try {
      await api.post('/campaigns', {
        ...data,
        sdrIds: selectedSdrIds
      });
      toast.success('Campaign created successfully!');
      setCreateCampaignOpen(false);
      reset();
      setSelectedSdrIds([]);
      fetchInitialData();
    } catch (err) {
      toast.error(apiError(err, 'Failed to create campaign.'));
    }
  };

  const handleEditCampaign = async (data) => {
    try {
      await api.put(`/campaigns/${editingCampaign.id}`, data);
      toast.success('Campaign updated successfully!');
      setEditCampaignOpen(false);
      fetchInitialData();
    } catch (err) {
      toast.error(apiError(err, 'Failed to update campaign.'));
    }
  };

  const handleStatusToggle = async (campaign, newStatus) => {
    try {
      await api.put(`/campaigns/${campaign.id}`, {
        name: campaign.name,
        status: newStatus
      });
      toast.success(`Campaign marked as ${newStatus}`);
      fetchInitialData();
    } catch (err) {
      toast.error(apiError(err, 'Failed to change campaign status.'));
    }
  };

  const handleDuplicateCampaign = async (id) => {
    try {
      const res = await api.post(`/campaigns/${id}/duplicate`);
      toast.success(`Campaign duplicated successfully! Created: ${res.data.name}`);
      fetchInitialData();
    } catch (err) {
      toast.error(apiError(err, 'Failed to duplicate campaign.'));
    }
  };

  const handleDeleteCampaign = async (id) => {
    if (confirm('Are you absolutely sure you want to delete this campaign? All matching performances, structures, and memberships will be deleted.')) {
      try {
        await api.delete(`/campaigns/${id}`);
        toast.success('Campaign deleted successfully');
        fetchInitialData();
      } catch (err) {
        toast.error(apiError(err, 'Failed to delete campaign.'));
      }
    }
  };

  const handleAssignMember = async (e) => {
    e.preventDefault();
    if (!assignEmployeeId) {
      toast.error('Please select an employee');
      return;
    }
    try {
      await api.post(`/campaigns/${selectedCampaignId}/members`, {
        employeeId: assignEmployeeId,
        role: assignRole
      });
      toast.success('Staff member assigned successfully');
      setAssignOpen(false);
      setAssignEmployeeId('');
      fetchInitialData();
      if (activeTab === 'dashboard') fetchDashboard();
    } catch (err) {
      toast.error(apiError(err, 'Failed to assign member.'));
    }
  };

  const handleRemoveMember = async (employeeId) => {
    if (confirm('Remove this employee from the campaign?')) {
      try {
        await api.delete(`/campaigns/${selectedCampaignId}/members/${employeeId}`);
        toast.success('Member removed');
        fetchInitialData();
        if (activeTab === 'dashboard') fetchDashboard();
      } catch (err) {
        toast.error(apiError(err, 'Failed to remove member.'));
      }
    }
  };

  // Slabs manipulation
  const handleOpenStructureModal = (struct = null) => {
    if (struct) {
      setSelectedStructure(struct);
      setStructureName(struct.name);
      setSlabs(struct.slabs.map(s => ({
        minShowups: s.minShowups,
        maxShowups: s.maxShowups === null ? '' : s.maxShowups,
        rate: s.rate,
        type: s.type
      })));
    } else {
      setSelectedStructure(null);
      setStructureName('');
      setSlabs([{ minShowups: 0, maxShowups: '', rate: 1000, type: 'per_showup' }]);
    }
    setStructureModalOpen(true);
  };

  const handleAddSlab = () => {
    setSlabs([...slabs, { minShowups: '', maxShowups: '', rate: 1000, type: 'per_showup' }]);
  };

  const handleRemoveSlab = (idx) => {
    setSlabs(slabs.filter((_, i) => i !== idx));
  };

  const handleSlabChange = (idx, field, value) => {
    const updated = [...slabs];
    updated[idx][field] = value;
    setSlabs(updated);
  };

  const handleSaveStructure = async (e) => {
    e.preventDefault();
    if (!structureName) {
      toast.error('Structure name is required');
      return;
    }

    try {
      const cleanSlabs = slabs.map(s => ({
        minShowups: parseInt(s.minShowups) || 0,
        maxShowups: s.maxShowups === '' || s.maxShowups === null ? null : parseInt(s.maxShowups),
        rate: parseFloat(s.rate) || 0,
        type: s.type
      }));

      // Validation check
      for (const s of cleanSlabs) {
        if (s.minShowups < 0 || s.rate < 0 || (s.maxShowups !== null && s.maxShowups < 0)) {
          toast.error('Slab values cannot be negative');
          return;
        }
        if (s.maxShowups !== null && s.minShowups > s.maxShowups) {
          toast.error(`Slab min (${s.minShowups}) cannot exceed max (${s.maxShowups})`);
          return;
        }
      }

      if (selectedStructure) {
        // Update
        await api.put(`/campaigns/structures/${selectedStructure.id}`, {
          name: structureName,
          slabs: cleanSlabs
        });
        toast.success('Commission structure updated successfully');
      } else {
        // Create
        await api.post(`/campaigns/${selectedCampaignId}/structures`, {
          name: structureName,
          slabs: cleanSlabs
        });
        toast.success('Commission structure created successfully');
      }

      setStructureModalOpen(false);
      fetchStructures();
    } catch (err) {
      toast.error(apiError(err, 'Failed to save the commission structure.'));
    }
  };

  const handleActivateStructure = async (id) => {
    try {
      await api.post(`/campaigns/structures/${id}/activate`);
      toast.success('Commission structure activated!');
      fetchStructures();
      fetchInitialData();
    } catch (err) {
      toast.error(apiError(err, 'Failed to activate the structure.'));
    }
  };

  const handleDeleteStructure = async (id) => {
    if (confirm('Delete this commission structure?')) {
      try {
        await api.delete(`/campaigns/structures/${id}`);
        toast.success('Structure deleted');
        fetchStructures();
      } catch (err) {
        toast.error(apiError(err, 'Failed to delete the structure.'));
      }
    }
  };

  const runSimulation = async (e) => {
    e.preventDefault();
    try {
      simLoading(true);
      const res = await api.post('/campaigns/preview-commission', {
        campaignId: selectedCampaignId,
        showups: parseInt(simShowups) || 0
      });
      setSimResults(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Simulation failed');
    } finally {
      setSimLoading(false);
    }
  };

  // Filtering campaigns
  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase">Campaigns & Commissions</h2>
          <p className="text-xs text-brand-text-soft mt-1">Manage sales campaigns, SDR success tiers, dynamic slabs, and TL override rules.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreateCampaignOpen(true)}
            className="px-5 py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg hover:scale-[1.02] active:scale-[0.98] font-bold font-display text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-blue/20"
          >
            <Plus className="w-4 h-4" />
            Create Campaign
          </button>
        )}
      </div>

      {/* Tabs Menu */}
      <div className="flex gap-2 border-b border-brand-border pb-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-xs font-bold font-display border-b-2 transition-all cursor-pointer ${
            activeTab === 'overview'
              ? 'border-brand-cyan text-brand-cyan'
              : 'border-transparent text-brand-text-soft hover:text-brand-text'
          }`}
        >
          Overview & Management
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 text-xs font-bold font-display border-b-2 transition-all cursor-pointer ${
            activeTab === 'dashboard'
              ? 'border-brand-cyan text-brand-cyan'
              : 'border-transparent text-brand-text-soft hover:text-brand-text'
          }`}
        >
          Performance Analytics
        </button>
        <button
          onClick={() => setActiveTab('commission_builder')}
          className={`px-4 py-2 text-xs font-bold font-display border-b-2 transition-all cursor-pointer ${
            activeTab === 'commission_builder'
              ? 'border-brand-cyan text-brand-cyan'
              : 'border-transparent text-brand-text-soft hover:text-brand-text'
          }`}
        >
          Commission Slab Builder
        </button>
        <button
          onClick={() => setActiveTab('simulator')}
          className={`px-4 py-2 text-xs font-bold font-display border-b-2 transition-all cursor-pointer ${
            activeTab === 'simulator'
              ? 'border-brand-cyan text-brand-cyan'
              : 'border-transparent text-brand-text-soft hover:text-brand-text'
          }`}
        >
          Commission Simulator
        </button>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : (
        <div>
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Search Bar */}
              <div className="flex flex-col md:flex-row gap-4 bg-brand-bg-elevated/40 p-4 rounded-2xl border border-brand-border">
                <div className="flex-1 relative">
                  <Search className="w-4 h-4 text-brand-text-soft absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search campaigns..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-brand-text-soft" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              {/* Grid List */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredCampaigns.map(camp => {
                  const activeStructure = camp.commissionStructures.find(cs => cs.status === 'active');
                  const teamLead = camp.members.find(m => m.role === 'team_lead' && m.status === 'active');
                  const sdrs = camp.members.filter(m => m.role === 'sdr' && m.status === 'active');

                  return (
                    <div key={camp.id} className="p-6 rounded-2xl glass-panel flex flex-col justify-between space-y-4 border border-brand-border/40 hover:border-brand-cyan/20 transition-all group">
                      <div className="space-y-3">
                        <div className="flex justify-between items-start">
                          <span className={`px-2.5 py-0.5 rounded-full text-[8px] font-extrabold border uppercase tracking-wider ${
                            camp.status === 'active'
                              ? 'bg-brand-green/10 text-brand-green border-brand-green/20'
                              : camp.status === 'inactive'
                              ? 'bg-brand-amber/10 text-brand-amber border-brand-amber/20'
                              : 'bg-brand-bg-elevated text-brand-text-mute border-brand-border'
                          }`}>
                            {camp.status}
                          </span>

                          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingCampaign(camp);
                                    setValue('name', camp.name);
                                    setValue('description', camp.description);
                                    setValue('monthlyShowupTarget', camp.monthlyShowupTarget);
                                    setValue('notes', camp.notes);
                                    setEditCampaignOpen(true);
                                  }}
                                  className="p-1 rounded bg-brand-bg border border-brand-border hover:text-brand-cyan text-brand-text-soft transition-colors cursor-pointer text-[10px]"
                                  title="Edit Campaign"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDuplicateCampaign(camp.id)}
                                  className="p-1 rounded bg-brand-bg border border-brand-border hover:text-brand-violet text-brand-text-soft transition-colors cursor-pointer text-[10px]"
                                  title="Duplicate Campaign"
                                >
                                  Clone
                                </button>
                                <button
                                  onClick={() => handleDeleteCampaign(camp.id)}
                                  className="p-1 rounded bg-brand-bg border border-brand-border hover:text-brand-amber text-brand-text-soft transition-colors cursor-pointer text-[10px]"
                                  title="Delete Campaign"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div>
                          <h3 className="text-base font-extrabold text-brand-text font-display group-hover:text-brand-cyan transition-colors">{camp.name}</h3>
                          <p className="text-xs text-brand-text-soft mt-1 leading-relaxed line-clamp-2">{camp.description || 'No description provided.'}</p>
                        </div>

                        <div className="space-y-1.5 text-xs border-t border-brand-border/40 pt-3">
                          <div className="flex justify-between text-brand-text-mute">
                            <span>Active structure:</span>
                            <span className="font-extrabold text-brand-cyan">{activeStructure ? activeStructure.name : 'None configured'}</span>
                          </div>
                          <div className="flex justify-between text-brand-text-mute">
                            <span>Lead:</span>
                            <span className="font-extrabold text-brand-text">{teamLead ? teamLead.employee.fullName : 'None'}</span>
                          </div>
                          <div className="flex justify-between text-brand-text-mute">
                            <span>SDR Staff size:</span>
                            <span className="font-extrabold text-brand-text font-mono">{sdrs.length}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-brand-border/40 pt-3 flex gap-2">
                        {camp.status === 'active' && isAdmin && (
                          <button
                            onClick={() => handleStatusToggle(camp, 'inactive')}
                            className="flex-1 py-1.5 rounded-lg bg-brand-amber/10 border border-brand-amber/20 hover:bg-brand-amber/20 text-brand-amber text-[10px] font-bold transition-all cursor-pointer text-center"
                          >
                            Deactivate
                          </button>
                        )}
                        {camp.status !== 'active' && isAdmin && (
                          <button
                            onClick={() => handleStatusToggle(camp, 'active')}
                            className="flex-1 py-1.5 rounded-lg bg-brand-green/10 border border-brand-green/20 hover:bg-brand-green/20 text-brand-green text-[10px] font-bold transition-all cursor-pointer text-center"
                          >
                            Activate
                          </button>
                        )}
                        {camp.status !== 'archived' && isAdmin && (
                          <button
                            onClick={() => handleStatusToggle(camp, 'archived')}
                            className="flex-1 py-1.5 rounded-lg bg-brand-bg-elevated border border-brand-border hover:bg-brand-bg-soft text-brand-text-mute hover:text-brand-text text-[10px] font-bold transition-all cursor-pointer text-center"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: PERFORMANCE DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Campaign Selector & Assign widget */}
              <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-brand-bg-elevated/40 p-4 rounded-2xl border border-brand-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-brand-text-soft font-bold uppercase tracking-wider">Select Campaign:</span>
                  <select
                    value={selectedCampaignId}
                    onChange={(e) => setSelectedCampaignId(e.target.value)}
                    className="px-3.5 py-2 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer font-bold"
                  >
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Period for the performance editor below. */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-brand-text-soft font-bold uppercase tracking-wider">Period:</span>
                  <select
                    value={perfMonth}
                    onChange={(e) => setPerfMonth(Number(e.target.value))}
                    aria-label="Performance month"
                    className="px-3 py-2 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer font-bold"
                  >
                    {MONTH_NAMES.map((m, idx) => (
                      <option key={m} value={idx + 1}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={perfYear}
                    onChange={(e) => setPerfYear(Number(e.target.value))}
                    aria-label="Performance year"
                    className="px-3 py-2 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer font-bold"
                  >
                    {payrollYears().map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                {isAdmin && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAssignOpen(true)}
                      className="px-4 py-2 rounded-full border border-brand-cyan/30 bg-brand-cyan/5 hover:bg-brand-cyan/10 text-brand-cyan text-xs font-bold transition-all cursor-pointer"
                    >
                      Assign Staff Member
                    </button>
                  </div>
                )}
              </div>

              {dashboardLoading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
                </div>
              ) : dashboardData ? (
                <div className="space-y-6">
                  {/* KPIs Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    <div className="p-5 rounded-2xl glass-panel border border-brand-border/40 relative overflow-hidden">
                      <div className="absolute right-2.5 top-2.5 p-2 rounded-lg bg-brand-cyan/10">
                        <Zap className="w-4 h-4 text-brand-cyan" />
                      </div>
                      <p className="text-[10px] text-brand-text-soft font-bold uppercase tracking-widest font-display">Meetings Booked</p>
                      <h3 className="text-2xl font-extrabold text-brand-text mt-2 font-mono">{dashboardData.stats.meetingsBooked}</h3>
                      <p className="text-[9px] text-brand-text-mute mt-2 font-bold">{dashboardData.stats.conversionRate}% meeting to show-up rate</p>
                    </div>

                    <div className="p-5 rounded-2xl glass-panel border border-brand-border/40 relative overflow-hidden">
                      <div className="absolute right-2.5 top-2.5 p-2 rounded-lg bg-brand-amber/10">
                        <ShieldAlert className="w-4 h-4 text-brand-amber" />
                      </div>
                      <p className="text-[10px] text-brand-text-soft font-bold uppercase tracking-widest font-display">No Shows & Cancelled</p>
                      <h3 className="text-2xl font-extrabold text-brand-text mt-2 font-mono">
                        {dashboardData.stats.noShows} <span className="text-xs text-brand-text-soft font-normal">No Show</span>
                        <span className="text-xs text-brand-text-soft font-normal mx-2">|</span>
                        {dashboardData.stats.cancelledMeetings} <span className="text-xs text-brand-text-soft font-normal">Cancel</span>
                      </h3>
                      <p className="text-[9px] text-brand-text-mute mt-2 font-bold">Lost pipeline meetings</p>
                    </div>

                    <div className="p-5 rounded-2xl glass-panel border border-brand-border/40 relative overflow-hidden">
                      <div className="absolute right-2.5 top-2.5 p-2 rounded-lg bg-brand-green/10">
                        <DollarSign className="w-4 h-4 text-brand-green" />
                      </div>
                      <p className="text-[10px] text-brand-text-soft font-bold uppercase tracking-widest font-display">Est. Commissions Paid</p>
                      <h3 className="text-2xl font-extrabold text-brand-green mt-2 font-mono">PKR {dashboardData.stats.commissionPaid.toLocaleString()}</h3>
                      <p className="text-[9px] text-brand-text-mute mt-2 font-bold">Includes SDR & TL override override</p>
                    </div>
                  </div>

                  {/* Leaderboard Table */}
                  <div className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-brand-border/40">
                      <h3 className="text-sm font-extrabold text-brand-text uppercase font-display flex items-center gap-2">
                        <Award className="w-4 h-4 text-brand-cyan" />
                        Campaign Leaderboard (SDR Rankings)
                      </h3>
                      <span className="text-[10px] text-brand-text-soft font-bold uppercase">Active Lead: {dashboardData.campaign.teamLead}</span>
                    </div>
                    {isAdmin && (
                      <p className="text-[10px] text-brand-text-mute -mt-2">
                        Edit any member's figures for {MONTH_NAMES[perfMonth - 1]} {perfYear} and press save. Logged figures drive commission on that month's payroll run.
                      </p>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="text-brand-text-mute font-bold uppercase tracking-wider text-[9px] border-b border-brand-border/30">
                            <th className="py-3 px-2">Rank</th>
                            <th className="py-3 px-2">Employee</th>
                            <th className="py-3 px-2 text-center font-mono">Booked</th>
                            <th className="py-3 px-2 text-center font-mono">Showups</th>
                            <th className="py-3 px-2 text-center font-mono">No Shows</th>
                            <th className="py-3 px-2 text-center font-mono">Cancelled</th>
                            <th className="py-3 px-2 text-right">Commission</th>
                            {isAdmin && <th className="py-3 px-2 text-center">Actions</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-border/20">
                          {dashboardData.leaderboard.map((item, idx) => (
                            <tr key={item.employeeId} className="hover:bg-brand-bg/40 transition-colors">
                              <td className="py-3.5 px-2 font-mono font-extrabold text-brand-cyan">{idx + 1}</td>
                              <td className="py-3.5 px-2">
                                <p className="font-bold text-brand-text">{item.fullName}</p>
                                <p className="text-[9px] text-brand-text-mute mt-0.5">{item.code}</p>
                              </td>
                              <td className="py-3.5 px-2 text-center font-mono font-bold">
                                {isAdmin ? perfInput(item.employeeId, 'meetingsBooked', `Meetings booked for ${item.fullName}`, 'text-brand-text') : item.meetingsBooked}
                              </td>
                              <td className="py-3.5 px-2 text-center font-mono font-bold text-brand-green">
                                {isAdmin ? perfInput(item.employeeId, 'showups', `Show-ups for ${item.fullName}`, 'text-brand-green font-bold') : item.showups}
                              </td>
                              <td className="py-3.5 px-2 text-center font-mono text-brand-text-soft">
                                {isAdmin ? perfInput(item.employeeId, 'noShows', `No-shows for ${item.fullName}`, 'text-brand-text-soft') : item.noShows}
                              </td>
                              <td className="py-3.5 px-2 text-center font-mono text-brand-text-soft">
                                {isAdmin ? perfInput(item.employeeId, 'cancelledMeetings', `Cancelled meetings for ${item.fullName}`, 'text-brand-text-soft') : item.cancelledMeetings}
                              </td>
                              <td className="py-3.5 px-2 text-right font-mono font-bold text-brand-green">PKR {item.commissionEarned.toLocaleString()}</td>
                              {isAdmin && (
                                <td className="py-3.5 px-2 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={() => saveAdminPerformance(item.employeeId)}
                                      disabled={perfSavingId === item.employeeId}
                                      className="p-1 rounded text-brand-text-mute hover:text-brand-cyan transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Save performance"
                                      aria-label={`Save performance for ${item.fullName}`}
                                    >
                                      <Save className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleRemoveMember(item.employeeId)}
                                      className="p-1 rounded text-brand-text-mute hover:text-brand-amber transition-colors cursor-pointer"
                                      title="Unassign Member"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}

                          {/* The lead's own metrics — kept out of the ranking and the team totals. */}
                          {isAdmin && dashboardData.campaign.teamLeadId && (
                            <tr className="border-t-2 border-brand-border/60 bg-brand-bg-elevated/20">
                              <td className="py-3.5 px-2 font-mono text-brand-text-mute">—</td>
                              <td className="py-3.5 px-2">
                                <p className="font-bold text-brand-text">{dashboardData.campaign.teamLead}</p>
                                <p className="text-[9px] text-brand-text-mute mt-0.5 uppercase tracking-widest">Team Lead · own metrics</p>
                              </td>
                              <td className="py-3.5 px-2 text-center">
                                {perfInput(dashboardData.campaign.teamLeadId, 'meetingsBooked', 'Meetings booked for the team lead', 'text-brand-text')}
                              </td>
                              <td className="py-3.5 px-2 text-center">
                                {perfInput(dashboardData.campaign.teamLeadId, 'showups', 'Show-ups for the team lead', 'text-brand-green font-bold')}
                              </td>
                              <td className="py-3.5 px-2 text-center font-mono text-brand-text-mute">—</td>
                              <td className="py-3.5 px-2 text-center font-mono text-brand-text-mute">—</td>
                              <td className="py-3.5 px-2 text-right font-mono font-bold text-brand-text">PKR {(dashboardData.stats.teamLeadCommission || 0).toLocaleString()}</td>
                              <td className="py-3.5 px-2 text-center">
                                <button
                                  onClick={() => saveAdminPerformance(dashboardData.campaign.teamLeadId)}
                                  disabled={perfSavingId === dashboardData.campaign.teamLeadId}
                                  className="p-1 rounded text-brand-text-mute hover:text-brand-cyan transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Save performance"
                                  aria-label="Save performance for the team lead"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          )}

                          {dashboardData.leaderboard.length === 0 && (
                            <tr>
                              <td colSpan={isAdmin ? 8 : 7} className="py-6 text-center text-brand-text-soft italic">No personnel assigned or registered logs found.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center py-6 text-brand-text-soft">No campaign selected or data found.</p>
              )}
            </div>
          )}

          {/* TAB 3: COMMISSION SLAB BUILDER */}
          {activeTab === 'commission_builder' && (
            <div className="space-y-6">
              {/* Selector */}
              <div className="flex justify-between items-center bg-brand-bg-elevated/40 p-4 rounded-2xl border border-brand-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-brand-text-soft font-bold uppercase tracking-wider">Select Campaign:</span>
                  <select
                    value={selectedCampaignId}
                    onChange={(e) => setSelectedCampaignId(e.target.value)}
                    className="px-3.5 py-2 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer font-bold"
                  >
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {isAdmin && (
                  <button
                    onClick={() => handleOpenStructureModal()}
                    className="px-4 py-2 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg text-xs font-bold transition-all cursor-pointer shadow"
                  >
                    + Create Commission Structure
                  </button>
                )}
              </div>

              {structuresLoading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
                </div>
              ) : (
                <div className="space-y-6">
                  {structures.map(struct => (
                    <div key={struct.id} className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <h3 className="text-base font-extrabold text-brand-text font-display">{struct.name}</h3>
                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase border ${
                              struct.status === 'active'
                                ? 'bg-brand-green/10 text-brand-green border-brand-green/20'
                                : struct.status === 'draft'
                                ? 'bg-brand-blue/10 text-brand-blue border-brand-blue/20'
                                : 'bg-brand-bg-elevated text-brand-text-soft border-brand-border'
                            }`}>
                              {struct.status}
                            </span>
                          </div>
                          <p className="text-[10px] text-brand-text-mute mt-1 font-mono">Created: {new Date(struct.createdAt).toDateString()}</p>
                        </div>

                        {isAdmin && (
                          <div className="flex items-center gap-3">
                            {struct.status !== 'active' && (
                              <button
                                onClick={() => handleActivateStructure(struct.id)}
                                className="px-3 py-1.5 rounded-lg bg-brand-green/15 hover:bg-brand-green/20 text-brand-green border border-brand-green/20 text-[10px] font-bold cursor-pointer transition-colors"
                              >
                                Activate Structure
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenStructureModal(struct)}
                              className="px-3 py-1.5 rounded-lg bg-brand-bg border border-brand-border hover:text-brand-cyan text-brand-text-soft text-[10px] font-bold cursor-pointer transition-colors"
                            >
                              Edit Slabs
                            </button>
                            <button
                              onClick={() => handleDeleteStructure(struct.id)}
                              className="p-1.5 rounded bg-brand-bg border border-brand-border hover:text-brand-amber text-brand-text-soft cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Slabs breakdown visual list */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-2">
                        {struct.slabs.map((slab, i) => (
                          <div key={slab.id} className="p-4 rounded-xl bg-brand-bg/40 border border-brand-border flex flex-col justify-between space-y-2">
                            <div>
                              <p className="text-[9px] text-brand-text-mute font-bold uppercase tracking-wider">Tier {i + 1}</p>
                              <h4 className="text-xs font-bold text-brand-text mt-1">
                                {slab.minShowups} to {slab.maxShowups === null ? '∞' : slab.maxShowups} Showups
                              </h4>
                            </div>
                            <div className="flex justify-between items-center border-t border-brand-border/40 pt-2 text-[10px]">
                              <span className="text-brand-text-mute uppercase font-extrabold">{slab.type.replace('_', ' ')}</span>
                              <span className="font-mono font-extrabold text-brand-cyan">PKR {slab.rate.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}

                        {struct.slabs.length === 0 && (
                          <div className="col-span-full py-4 text-center text-brand-text-soft italic">No commission slabs defined. Add a slab range.</div>
                        )}
                      </div>
                    </div>
                  ))}

                  {structures.length === 0 && (
                    <div className="p-8 rounded-2xl glass-panel border border-brand-border/40 text-center text-brand-text-soft italic">
                      No commission structures configured for this campaign.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: COMMISSION SIMULATOR */}
          {activeTab === 'simulator' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Form Input panel */}
                <div className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4 h-fit">
                  <h3 className="text-sm font-extrabold text-brand-text uppercase font-display flex items-center gap-2">
                    <Percent className="w-4 h-4 text-brand-cyan" />
                    Calculator Parameters
                  </h3>
                  <p className="text-xs text-brand-text-soft leading-relaxed">
                    Test commission structure calculations on-the-fly. Choose a campaign, specify monthly showups, and preview calculations.
                  </p>

                  <form onSubmit={runSimulation} className="space-y-4 border-t border-brand-border/40 pt-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Selected Campaign</label>
                      <select
                        value={selectedCampaignId}
                        onChange={(e) => { setSelectedCampaignId(e.target.value); setSimResults(null); }}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer"
                      >
                        {campaigns.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Monthly Show-ups Count</label>
                      <input
                        type="number"
                        value={simShowups}
                        onChange={(e) => { setSimShowups(e.target.value); setSimResults(null); }}
                        placeholder="e.g. 15"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue font-mono font-bold"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={simLoading}
                      className="w-full py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow-lg shadow-brand-blue/15 hover:scale-[1.01] active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
                    >
                      {simLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Run Calculator Simulation'}
                    </button>
                  </form>
                </div>

                {/* Results panel */}
                <div className="lg:col-span-2 p-6 rounded-2xl glass-panel border border-brand-border/40 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-sm font-extrabold text-brand-text uppercase font-display border-b border-brand-border/40 pb-2 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-brand-cyan" />
                      Calculated Payout Breakdowns
                    </h3>

                    {simResults ? (
                      <div className="mt-4 space-y-4">
                        <div className="p-4 rounded-xl bg-brand-bg/40 border border-brand-border space-y-2">
                          <p className="text-[10px] text-brand-text-soft font-bold uppercase tracking-wider">Matched active Structure</p>
                          <h4 className="text-sm font-bold text-brand-text">{simResults.structureName}</h4>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="p-4 rounded-xl bg-brand-bg/40 border border-brand-border space-y-1">
                            <p className="text-[10px] text-brand-text-soft font-bold uppercase tracking-wider">Matched Slab Range</p>
                            {simResults.slabMatched ? (
                              <h4 className="text-xs font-bold text-brand-text">
                                {simResults.slabMatched.min} to {simResults.slabMatched.max === null ? '∞' : simResults.slabMatched.max} Showups
                              </h4>
                            ) : (
                              <h4 className="text-xs font-bold text-brand-text-mute italic">No Slab Matched</h4>
                            )}
                          </div>

                          <div className="p-4 rounded-xl bg-brand-bg/40 border border-brand-border space-y-1">
                            <p className="text-[10px] text-brand-text-soft font-bold uppercase tracking-wider">Slab Rate & Type</p>
                            {simResults.slabMatched ? (
                              <h4 className="text-xs font-bold text-brand-cyan font-mono">
                                PKR {simResults.slabMatched.rate.toLocaleString()} ({simResults.slabMatched.type.replace('_', ' ')})
                              </h4>
                            ) : (
                              <h4 className="text-xs font-bold text-brand-text-mute italic">N/A</h4>
                            )}
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-brand-bg/50 border border-brand-border space-y-2">
                          <p className="text-[10px] text-brand-text-soft font-bold uppercase tracking-wider">Slab Payout Formula Explanation</p>
                          <p className="text-xs text-brand-text font-mono font-bold leading-relaxed">{simResults.formulaExplanation}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="py-16 text-center text-brand-text-soft italic flex flex-col items-center justify-center gap-2">
                        <Info className="w-6 h-6 text-brand-text-mute" />
                        Enter showups on the left to simulate commission slab payouts.
                      </div>
                    )}
                  </div>

                  {simResults && (
                    <div className="p-4 rounded-xl bg-gradient-to-r from-brand-blue/10 via-brand-violet/10 to-brand-cyan/10 border border-brand-cyan/20 flex justify-between items-center">
                      <span className="text-xs font-extrabold text-brand-text uppercase tracking-wider font-display">Total Calculated Commission</span>
                      <span className="text-xl font-extrabold text-brand-green font-mono">PKR {simResults.calculatedCommission.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- CREATE CAMPAIGN MODAL ---------------- */}
      {createCampaignOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCreateCampaignOpen(false)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-glow relative z-50 text-left">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Create Campaign</h3>
              <button onClick={() => { setCreateCampaignOpen(false); setSelectedSdrIds([]); }} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit(handleCreateCampaign)} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Campaign Name</label>
                <input type="text" {...register('name', { required: true })} placeholder="e.g. US Solar Campaign" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Description</label>
                <textarea rows={3} {...register('description')} placeholder="Detail the campaign parameters..." className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
              </div>
              
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Assign Team Lead (Optional)</label>
                <select
                  {...register('teamLeadId')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer"
                >
                  <option value="">No Lead Assigned</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Assign SDRs (Check to Add)</label>
                <div className="max-h-40 overflow-y-auto p-3 rounded-xl border border-brand-border bg-brand-bg/40 space-y-2">
                  {employees.map(e => (
                    <label key={e.id} className="flex items-center gap-2 text-xs text-brand-text cursor-pointer hover:text-brand-cyan">
                      <input
                        type="checkbox"
                        value={e.id}
                        onChange={(evt) => {
                          const checked = evt.target.checked;
                          if (checked) {
                            setSelectedSdrIds(prev => [...prev, e.id]);
                          } else {
                            setSelectedSdrIds(prev => prev.filter(id => id !== e.id));
                          }
                        }}
                        checked={selectedSdrIds.includes(e.id)}
                        className="rounded bg-brand-bg border-brand-border text-brand-cyan focus:ring-0 cursor-pointer"
                      />
                      <span>{e.fullName} ({e.employeeCode})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Internal Notes</label>
                <input type="text" {...register('notes')} placeholder="Campaign rules overview..." className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow shadow-brand-blue/15">Save Campaign</button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- EDIT CAMPAIGN MODAL ---------------- */}
      {editCampaignOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditCampaignOpen(false)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-glow relative z-50 text-left">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Edit Campaign Details</h3>
              <button onClick={() => setEditCampaignOpen(false)} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit(handleEditCampaign)} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Campaign Name</label>
                <input type="text" {...register('name', { required: true })} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Description</label>
                <textarea rows={3} {...register('description')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Internal Notes</label>
                <input type="text" {...register('notes')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow shadow-brand-blue/15">Update Campaign</button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- ASSIGN STAFF MODAL ---------------- */}
      {assignOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAssignOpen(false)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-glow relative z-50 text-left">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Assign Campaign Personnel</h3>
              <button onClick={() => setAssignOpen(false)} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleAssignMember} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Select Profile</label>
                <select
                  value={assignEmployeeId}
                  onChange={(e) => setAssignEmployeeId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer"
                >
                  <option value="">Choose employee...</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Campaign Role</label>
                <select
                  value={assignRole}
                  onChange={(e) => setAssignRole(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer"
                >
                  <option value="sdr">SDR (Outreach Agent)</option>
                  <option value="team_lead">Team Lead (Operational Lead)</option>
                </select>
              </div>

              <button type="submit" className="w-full py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow shadow-brand-blue/15">Save Assignment</button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- COMMISSION SLAB BUILDER MODAL ---------------- */}
      {structureModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setStructureModalOpen(false)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-3xl shadow-glow relative z-50 text-left max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-6">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Configure Commission Slabs</h3>
              <button onClick={() => setStructureModalOpen(false)} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>

            <form onSubmit={handleSaveStructure} className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Structure Name</label>
                <input
                  type="text"
                  value={structureName}
                  onChange={(e) => setStructureName(e.target.value)}
                  placeholder="e.g. Standard Tiered Showups Plan"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-brand-border pb-2">
                  <h4 className="text-xs font-bold text-brand-text uppercase tracking-widest font-display">Slabs Configuration</h4>
                  <button
                    type="button"
                    onClick={handleAddSlab}
                    className="text-[10px] font-bold text-brand-cyan hover:underline cursor-pointer"
                  >
                    + Add New Slab Tier
                  </button>
                </div>

                <div className="space-y-3">
                  {slabs.map((slab, i) => (
                    <div key={i} className="flex items-center gap-3 bg-brand-bg/40 p-4 rounded-xl border border-brand-border">
                      <div className="flex-1">
                        <label className="block text-[8px] uppercase text-brand-text-mute font-bold mb-1">Min Showups</label>
                        <input
                          type="number"
                          value={slab.minShowups}
                          onChange={(e) => handleSlabChange(i, 'minShowups', e.target.value)}
                          placeholder="e.g. 0"
                          className="w-full px-2.5 py-1.5 rounded bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none"
                        />
                      </div>

                      <div className="flex-1">
                        <label className="block text-[8px] uppercase text-brand-text-mute font-bold mb-1">Max Showups (leave empty for ∞)</label>
                        <input
                          type="number"
                          value={slab.maxShowups}
                          onChange={(e) => handleSlabChange(i, 'maxShowups', e.target.value)}
                          placeholder="e.g. 10"
                          className="w-full px-2.5 py-1.5 rounded bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none"
                        />
                      </div>

                      <div className="flex-1">
                        <label className="block text-[8px] uppercase text-brand-text-mute font-bold mb-1">Rate (PKR)</label>
                        <input
                          type="number"
                          value={slab.rate}
                          onChange={(e) => handleSlabChange(i, 'rate', e.target.value)}
                          placeholder="e.g. 3000"
                          className="w-full px-2.5 py-1.5 rounded bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none font-mono"
                        />
                      </div>

                      <div className="flex-1">
                        <label className="block text-[8px] uppercase text-brand-text-mute font-bold mb-1">Rate Type</label>
                        <select
                          value={slab.type}
                          onChange={(e) => handleSlabChange(i, 'type', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer"
                        >
                          <option value="per_showup">Per Show-up</option>
                          <option value="fixed_monthly">Fixed Monthly Payout</option>
                          <option value="percentage">Percentage Multiplier</option>
                          <option value="hybrid">Hybrid Override</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveSlab(i)}
                        className="p-1.5 mt-4 rounded hover:bg-brand-bg-soft text-brand-text-mute hover:text-brand-amber transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {slabs.length === 0 && (
                    <p className="text-[10px] text-brand-text-soft italic text-center py-4">No slab tiers configured. Click "+ Add New Slab Tier".</p>
                  )}
                </div>
              </div>

              <button type="submit" className="w-full py-3 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow shadow-brand-blue/15">Save Slab Settings</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
