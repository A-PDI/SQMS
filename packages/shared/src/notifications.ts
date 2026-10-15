/** Notification event types users can configure (in-app / email). Keep in sync with services emitting them. */
export interface NotificationEventDefinition {
  eventType: string;
  group: string;
  label: string;
}

export const NOTIFICATION_EVENTS: NotificationEventDefinition[] = [
  { group: "Approvals", eventType: "approval.requested", label: "Approval assigned to me or my role" },
  { group: "Approvals", eventType: "approval.escalated", label: "Approval escalated" },
  { group: "Approvals", eventType: "workflow.approved", label: "A record I submitted was approved" },
  { group: "Approvals", eventType: "workflow.rejected", label: "A record I submitted was rejected" },
  { group: "Approvals", eventType: "workflow.info_requested", label: "More information requested on my submission" },
  { group: "Approvals", eventType: "approval.approve", label: "An approver approved a step of my submission" },
  { group: "Approvals", eventType: "approval.reject", label: "An approver rejected my submission" },
  { group: "Approvals", eventType: "approval.request_info", label: "An approver requested information on my submission" },
  { group: "Tasks", eventType: "task.assigned", label: "Task assigned to me" },
  { group: "Tasks", eventType: "task.due_soon", label: "Task due soon" },
  { group: "Tasks", eventType: "task.overdue", label: "Task overdue" },
  { group: "Sourcing", eventType: "project.intake_approved", label: "Sourcing project approved to proceed" },
  { group: "Sourcing", eventType: "product.approved", label: "Product approved" },
  { group: "Documents", eventType: "document.released", label: "Document released" },
  { group: "Suppliers", eventType: "certification.expiring", label: "Supplier certification expiring" },
  { group: "Suppliers", eventType: "certification.expired", label: "Supplier certification expired" },
  { group: "Change control", eventType: "change_request.submitted", label: "Change request submitted" },
  { group: "Change control", eventType: "change_request.info_requested", label: "Information requested on a change request" },
  { group: "Change control", eventType: "change_request.approved", label: "Change request approved" },
  { group: "Change control", eventType: "change_request.rejected", label: "Change request rejected" },
  { group: "Change control", eventType: "change_request.shipment_authorized", label: "Shipment of changed product authorized" },
  { group: "Quality", eventType: "ncr.created", label: "Nonconformance raised" },
  { group: "Quality", eventType: "deviation.approved", label: "Deviation / concession approved" },
  { group: "Quality", eventType: "deviation.rejected", label: "Deviation / concession rejected" },
  { group: "Quality", eventType: "deviation.info_requested", label: "Information requested on a deviation" },
  { group: "Quality", eventType: "deviation.expired", label: "Deviation expired" },
  { group: "Quality", eventType: "scar.issued", label: "Corrective action request issued" },
  { group: "Quality", eventType: "scar.response_submitted", label: "8D response submitted" },
  { group: "Quality", eventType: "scar.response_accepted", label: "8D response accepted" },
  { group: "Quality", eventType: "scar.response_rejected", label: "8D response rejected" },
  { group: "Quality", eventType: "scar.overdue", label: "Corrective action response overdue" },
  { group: "Quality", eventType: "scar.not_effective", label: "Corrective actions not effective" },
  { group: "Quality", eventType: "scar.closed", label: "Corrective action request closed" },
];

export const NOTIFICATION_EVENT_TYPES = new Set(NOTIFICATION_EVENTS.map((e) => e.eventType));
