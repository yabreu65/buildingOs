'use client';

import { useMemo, useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X, Lightbulb, ArrowLeft } from 'lucide-react';
import type { Ticket } from '../services/tickets.api';
import { getTicketReplySuggestions } from '../services/tickets.api';
import { useAuth } from '@/features/auth';
import { t } from '@/i18n';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { useAssignableTicketMembers } from '@/features/memberships/useAssignableTicketMembers';

type TicketDetailVariant = 'modal' | 'page';
type TicketPriority = Ticket['priority'];
type TicketStatus = Ticket['status'];

interface TicketDetailProps {
  ticket: Ticket;
  tenantId: string;
  variant?: TicketDetailVariant;
  onClose?: () => void;
  onBack?: () => void;
  onStatusChange: (ticketId: string, newStatus: string) => Promise<void>;
  onPriorityChange?: (ticketId: string, newPriority: TicketPriority) => Promise<void>;
  onAddComment: (ticketId: string, body: string) => Promise<void>;
  onAssign?: (ticketId: string, membershipId: string) => Promise<void>;
}

const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: ['OPEN'],
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En progreso',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

const CATEGORY_LABELS: Record<Ticket['category'], string> = {
  MAINTENANCE: 'Mantenimiento',
  REPAIR: 'Reparación',
  CLEANING: 'Limpieza',
  COMPLAINT: 'Reclamo',
  SAFETY: 'Seguridad',
  BILLING: 'Facturación',
  OTHER: 'Otro',
};

const ADMIN_ROLES = new Set(['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR']);

function isAdminRole(roles: string[] | undefined): boolean {
  return roles?.some((role) => ADMIN_ROLES.has(role)) ?? false;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('es-AR');
}

export function TicketDetail({
  ticket,
  tenantId,
  variant = 'page',
  onClose,
  onBack,
  onStatusChange,
  onPriorityChange,
  onAddComment,
  onAssign,
}: TicketDetailProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [commentBody, setCommentBody] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingComment, setAddingComment] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [changingPriority, setChangingPriority] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showSmartReplies, setShowSmartReplies] = useState(false);
  const [smartReplies, setSmartReplies] = useState<string[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const isAdmin = isAdminRole(currentUser?.roles);
  const adminTenantId = isAdmin ? tenantId : '';

  const { data: members = [], isLoading: loadingAssignableMembers } = useAssignableTicketMembers(adminTenantId);
  const [assigning, setAssigning] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(ticket.assignedTo?.id || '');
  const [selectedPriority, setSelectedPriority] = useState<TicketPriority>(ticket.priority);

  const allowedTransitions = VALID_TRANSITIONS[ticket.status] || [];
  const backHandler = onBack ?? onClose;
  const selfAssignableMember = useMemo(
    () => members.find((member) => member.email === currentUser?.email),
    [currentUser?.email, members],
  );

  const handleAddComment = async () => {
    if (!commentBody.trim()) {
      setActionError(t('tickets.errors.commentEmpty'));
      toast(t('tickets.errors.commentEmpty'), 'error');
      return;
    }

    setAddingComment(true);
    try {
      setActionError(null);
      await onAddComment(ticket.id, commentBody);
      setCommentBody('');
      toast(t('tickets.commentAdded'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('tickets.errors.commentFailed');
      setActionError(message);
      toast(message, 'error');
    } finally {
      setAddingComment(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setChangingStatus(true);
    try {
      setActionError(null);
      if (newStatus === 'CLOSED') {
        setShowCloseConfirm(true);
      } else {
        await onStatusChange(ticket.id, newStatus);
        toast(t('tickets.statusUpdated') || 'Estado actualizado', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('tickets.errors.statusUpdateFailed') || 'Error al actualizar estado';
      setActionError(message);
      toast(message, 'error');
    } finally {
      setChangingStatus(false);
    }
  };

  const confirmClose = async () => {
    setShowCloseConfirm(false);
    try {
      setActionError(null);
      await onStatusChange(ticket.id, 'CLOSED');
      toast(t('tickets.statusUpdated') || 'Estado actualizado', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('tickets.errors.statusUpdateFailed') || 'Error al actualizar estado';
      setActionError(message);
      toast(message, 'error');
    }
  };

  const handlePriorityChange = async () => {
    if (!onPriorityChange) return;
    setChangingPriority(true);
    try {
      setActionError(null);
      await onPriorityChange(ticket.id, selectedPriority);
      toast(t('tickets.statusUpdated') || 'Prioridad actualizada', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al actualizar prioridad';
      setActionError(message);
      toast(message, 'error');
    } finally {
      setChangingPriority(false);
    }
  };

  const handleAssign = async () => {
    if (!onAssign) return;
    setAssigning(true);
    try {
      setActionError(null);
      await onAssign(ticket.id, selectedMemberId || '');
      toast(selectedMemberId ? 'Asignación actualizada' : 'Asignación removida', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al asignar a';
      setActionError(message);
      toast(message, 'error');
    } finally {
      setAssigning(false);
    }
  };

  const handleFetchSmartReplies = async () => {
    setLoadingReplies(true);
    try {
      const result = await getTicketReplySuggestions(
        tenantId,
        ticket.id,
        ticket.title,
        ticket.description
      );
      setSmartReplies(result.replies);
      setShowSmartReplies(true);
    } catch {
      toast('Failed to load reply suggestions', 'error');
    } finally {
      setLoadingReplies(false);
    }
  };

  const handleSelectSmartReply = (reply: string) => {
    setCommentBody(reply);
    setShowSmartReplies(false);
  };

  if (variant === 'page') {
    const statusBadgeClass = ticket.status === 'OPEN'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : ticket.status === 'IN_PROGRESS'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : ticket.status === 'RESOLVED'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-muted text-muted-foreground border-border';

    const priorityBadgeClass = ticket.priority === 'LOW'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : ticket.priority === 'MEDIUM'
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : ticket.priority === 'HIGH'
          ? 'bg-orange-50 text-orange-700 border-orange-200'
          : 'bg-red-50 text-red-700 border-red-200';

    const commonInfoRows = [
      { label: 'Edificio', value: ticket.building?.name || '—' },
      { label: 'Unidad', value: ticket.unit ? `${ticket.unit.label} (${ticket.unit.code})` : 'Sin unidad asociada' },
      { label: 'Reportado por', value: ticket.createdBy?.name || '—' },
      { label: 'Creado', value: formatDateTime(ticket.createdAt) },
      { label: 'Actualizado', value: formatDateTime(ticket.updatedAt) },
      { label: 'Categoría', value: CATEGORY_LABELS[ticket.category] },
    ];

    return (
      <ErrorBoundary level="feature">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="secondary"
              onClick={() => backHandler?.()}
              className="inline-flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Detalle operativo</p>
              <p className="text-sm text-muted-foreground">URL canónica recargable</p>
            </div>
          </div>

          <header className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2 min-w-0">
                <p className="text-sm text-muted-foreground break-all">Ticket #{ticket.id}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground break-words">{ticket.title}</h1>
                  {ticket.aiSuggestedCategory && (
                    <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      IA sugirió
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {ticket.building?.name || 'Sin edificio'} · {ticket.unit ? `${ticket.unit.label} (${ticket.unit.code})` : 'Sin unidad asociada'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${statusBadgeClass}`}>
                  {STATUS_LABELS[ticket.status]}
                </span>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${priorityBadgeClass}`}>
                  {PRIORITY_LABELS[ticket.priority]}
                </span>
              </div>
            </div>
          </header>

          {actionError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {actionError}
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
            <main className="space-y-6">
              <Card className="p-6 space-y-4 bg-card text-card-foreground border-border">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Descripción inicial</h2>
                  <p className="text-xs text-muted-foreground">Contenido original del ticket</p>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{ticket.description}</p>
              </Card>

              <Card className="p-6 space-y-5 bg-card text-card-foreground border-border">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t('common.comments')} ({ticket.comments?.length || 0})</h2>
                  <p className="text-xs text-muted-foreground">Conversación real del ticket</p>
                </div>

                <div className="space-y-3">
                  {(!ticket.comments || ticket.comments.length === 0) && (
                    <p className="text-sm text-muted-foreground">{t('tickets.noComments')}</p>
                  )}
                  {ticket.comments?.map((comment) => (
                    <div key={comment.id} className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-foreground">{comment.author.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {comment.author.id === ticket.createdBy?.id ? 'Residente' : 'Administración'}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</p>
                      </div>
                      <p className="text-sm leading-6 text-foreground whitespace-pre-wrap">{comment.body}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <label htmlFor="ticket-comment" className="block text-sm font-medium text-foreground">
                    Responder
                  </label>
                  <textarea
                    id="ticket-comment"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Escribir una respuesta..."
                    className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={handleAddComment}
                      disabled={addingComment || !commentBody.trim()}
                      className="inline-flex items-center gap-2"
                    >
                      {addingComment ? 'Enviando...' : 'Enviar respuesta'}
                    </Button>
                    {isAdmin && (
                      <Button
                        onClick={handleFetchSmartReplies}
                        disabled={loadingReplies}
                        variant="secondary"
                        className="inline-flex items-center gap-2"
                      >
                        <Lightbulb className="w-4 h-4" />
                        {loadingReplies ? 'Cargando sugerencias...' : 'Sugerencias IA'}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </main>

            <aside className="space-y-4">
              <Card className="p-5 space-y-4 bg-card text-card-foreground border-border">
                <h2 className="text-base font-semibold">Información del ticket</h2>
                <dl className="space-y-3 text-sm">
                  {commonInfoRows.map((row) => (
                    <div key={row.label} className="space-y-0.5">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-medium text-foreground break-words">{row.value}</dd>
                    </div>
                  ))}
                  {ticket.closedAt && (
                    <div className="space-y-0.5">
                      <dt className="text-muted-foreground">Cerrado</dt>
                      <dd className="font-medium text-foreground">{formatDateTime(ticket.closedAt)}</dd>
                    </div>
                  )}
                </dl>
              </Card>

              {isAdmin && (
                <Card className="p-5 space-y-4 bg-card text-card-foreground border-border">
                  <h2 className="text-base font-semibold">Acciones administrativas</h2>

                  <div className="space-y-2">
                    <label htmlFor="ticket-status" className="block text-sm font-medium text-foreground">
                      Estado
                    </label>
                    <div className="flex flex-col gap-2">
                      <select
                        id="ticket-status"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            void handleStatusChange(e.target.value);
                            e.currentTarget.value = '';
                          }
                        }}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                      >
                        <option value="">Cambiar estado</option>
                        {allowedTransitions.map((status) => (
                          <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                      {changingStatus && <p className="text-xs text-muted-foreground">Actualizando estado...</p>}
                    </div>
                  </div>

                  {onPriorityChange && (
                    <div className="space-y-2">
                      <label htmlFor="ticket-priority" className="block text-sm font-medium text-foreground">
                        Prioridad
                      </label>
                      <div className="flex flex-col gap-2">
                        <select
                          id="ticket-priority"
                          value={selectedPriority}
                          onChange={(e) => setSelectedPriority(e.target.value as TicketPriority)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                        >
                          {Object.keys(PRIORITY_LABELS).map((priority) => (
                            <option key={priority} value={priority}>
                              {PRIORITY_LABELS[priority as TicketPriority]}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          onClick={() => void handlePriorityChange()}
                          disabled={changingPriority}
                        >
                          {changingPriority ? 'Guardando...' : 'Guardar prioridad'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {onAssign && (
                    <div className="space-y-2">
                      <label htmlFor="ticket-assignee" className="block text-sm font-medium text-foreground">
                        Responsable
                      </label>
                      {loadingAssignableMembers ? (
                        <p className="text-sm text-muted-foreground">Cargando personal operativo...</p>
                      ) : members.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No hay personal operativo disponible para asignar.</p>
                      ) : (
                        <div className="space-y-2">
                          <select
                            id="ticket-assignee"
                            value={selectedMemberId}
                            onChange={(e) => setSelectedMemberId(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                          >
                            <option value="">Sin asignar</option>
                            {members.map((member) => (
                              <option key={member.membershipId} value={member.membershipId}>
                                {member.name}
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-wrap gap-2">
                            {selfAssignableMember && (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setSelectedMemberId(selfAssignableMember.membershipId)}
                              >
                                Asignarme
                              </Button>
                            )}
                            <Button size="sm" onClick={handleAssign} disabled={assigning}>
                              {assigning ? 'Asignando...' : 'Guardar responsable'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              <Card className="p-5 space-y-3 bg-card text-card-foreground border-border">
                <h2 className="text-base font-semibold">Transiciones válidas</h2>
                <div className="flex flex-wrap gap-2">
                  {allowedTransitions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay transiciones disponibles.</p>
                  ) : (
                    allowedTransitions.map((status) => (
                      <span key={status} className="rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground">
                        {STATUS_LABELS[status]}
                      </span>
                    ))
                  )}
                </div>
              </Card>
            </aside>
          </div>

          {showCloseConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <Card className="w-[400px] p-6 space-y-4">
                <h3 className="text-lg font-bold">{t('tickets.closeConfirmTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('tickets.closeConfirmMessage')}</p>
                <div className="flex gap-2 justify-end">
                  <Button variant="secondary" onClick={() => setShowCloseConfirm(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={confirmClose} className="bg-red-600 hover:bg-red-700">
                    {t('tickets.closeButton')}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {showSmartReplies && smartReplies.length > 0 && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <Card className="w-[500px] max-h-[80vh] overflow-hidden flex flex-col p-6 rounded-lg">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Lightbulb className="w-5 h-5" />
                    Sugerencias de Respuesta IA
                  </h3>
                  <button
                    onClick={() => setShowSmartReplies(false)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 mb-4">
                  {smartReplies.map((reply, index) => (
                    <div
                      key={index}
                      className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition"
                      onClick={() => handleSelectSmartReply(reply)}
                    >
                      <p className="text-sm text-gray-700">{reply}</p>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowSmartReplies(false)}
                    className="flex-1"
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }

}

export default TicketDetail;
