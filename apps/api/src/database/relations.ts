import { relations } from "drizzle-orm";
import {
  accountTable,
  activityTable,
  agentTable,
  aiApprovalTable,
  aiRunStepTable,
  aiRunTable,
  analyticsReportTable,
  apikeyTable,
  assetTable,
  automationRuleTable,
  automationRunTable,
  columnTable,
  commentTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  cycleTable,
  cycleTaskTable,
  estimatePointTable,
  estimateTable,
  externalLinkTable,
  favoriteTable,
  flowAlertTable,
  githubIntegrationTable,
  homePreferenceTable,
  instanceSettingTable,
  intakeItemTable,
  integrationTable,
  invitationTable,
  labelTable,
  moduleLinkTable,
  moduleMemberTable,
  moduleTable,
  moduleTaskTable,
  notificationTable,
  pageReferenceTable,
  pageTable,
  pageTemplateTable,
  pageVersionTable,
  projectAutomationTable,
  projectMemberTable,
  projectPublicationTable,
  projectTable,
  publicBoardBlockTable,
  quickLinkTable,
  reactionTable,
  recentVisitTable,
  savedViewTable,
  sessionTable,
  stickyTable,
  taskAssigneeTable,
  taskDraftTable,
  taskExportFileTable,
  taskExportTable,
  taskLinkTable,
  taskMentionTable,
  taskRelationTable,
  taskReminderSentTable,
  taskSubscriberTable,
  taskTable,
  taskTemplateTable,
  taskVoteTable,
  teamMemberTable,
  teamTable,
  timeEntryTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceProjectTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  verificationTable,
  webhookDeliveryTable,
  workflowRuleTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
  workspaceWebhookTable,
} from "./schema";

export const userTableRelations = relations(userTable, ({ many, one }) => ({
  sessions: many(sessionTable),
  accounts: many(accountTable),
  teamMembers: many(teamMemberTable),
  workspaceMemberships: many(workspaceUserTable),
  // Tasks whose first assignee (the task.assignee_id mirror) is this user.
  assignedTasks: many(taskTable),
  taskAssignments: many(taskAssigneeTable),
  timeEntries: many(timeEntryTable),
  activities: many(activityTable),
  comments: many(commentTable),
  assets: many(assetTable),
  notifications: many(notificationTable, { relationName: "notificationUser" }),
  actedNotifications: many(notificationTable, {
    relationName: "notificationActor",
  }),
  notificationPreference: one(userNotificationPreferenceTable),
  notificationWorkspaceRules: many(userNotificationWorkspaceRuleTable),
  sentInvitations: many(invitationTable),
  apikeys: many(apikeyTable),
  taskSubscriptions: many(taskSubscriberTable),
  taskMentions: many(taskMentionTable),
  reactions: many(reactionTable),
}));

export const sessionTableRelations = relations(sessionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [sessionTable.userId],
    references: [userTable.id],
  }),
}));

export const accountTableRelations = relations(accountTable, ({ one }) => ({
  user: one(userTable, {
    fields: [accountTable.userId],
    references: [userTable.id],
  }),
}));

export const verificationTableRelations = relations(
  verificationTable,
  () => ({}),
);

export const workspaceTableRelations = relations(
  workspaceTable,
  ({ many }) => ({
    teams: many(teamTable),
    members: many(workspaceUserTable),
    projects: many(projectTable),
    assets: many(assetTable),
    invitations: many(invitationTable),
    notificationWorkspaceRules: many(userNotificationWorkspaceRuleTable),
  }),
);

export const workspaceUserTableRelations = relations(
  workspaceUserTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [workspaceUserTable.workspaceId],
      references: [workspaceTable.id],
    }),
    user: one(userTable, {
      fields: [workspaceUserTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const projectTableRelations = relations(
  projectTable,
  ({ one, many }) => ({
    workspace: one(workspaceTable, {
      fields: [projectTable.workspaceId],
      references: [workspaceTable.id],
    }),
    tasks: many(taskTable),
    assets: many(assetTable),
    columns: many(columnTable),
    workflowRules: many(workflowRuleTable),
    githubIntegration: many(githubIntegrationTable),
    integrations: many(integrationTable),
    notificationWorkspaceProjects: many(userNotificationWorkspaceProjectTable),
    members: many(projectMemberTable),
  }),
);

export const projectMemberTableRelations = relations(
  projectMemberTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [projectMemberTable.projectId],
      references: [projectTable.id],
    }),
    user: one(userTable, {
      fields: [projectMemberTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const columnTableRelations = relations(columnTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [columnTable.projectId],
    references: [projectTable.id],
  }),
  tasks: many(taskTable),
  workflowRules: many(workflowRuleTable),
}));

export const workflowRuleTableRelations = relations(
  workflowRuleTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [workflowRuleTable.projectId],
      references: [projectTable.id],
    }),
    column: one(columnTable, {
      fields: [workflowRuleTable.columnId],
      references: [columnTable.id],
    }),
  }),
);

export const taskTableRelations = relations(taskTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [taskTable.projectId],
    references: [projectTable.id],
  }),
  // The first assignee (the mirror); every assignee is in `assignees`.
  assignee: one(userTable, {
    fields: [taskTable.userId],
    references: [userTable.id],
  }),
  assignees: many(taskAssigneeTable),
  column: one(columnTable, {
    fields: [taskTable.columnId],
    references: [columnTable.id],
  }),
  estimatePoint: one(estimatePointTable, {
    fields: [taskTable.estimatePointId],
    references: [estimatePointTable.id],
  }),
  timeEntries: many(timeEntryTable),
  activities: many(activityTable),
  comments: many(commentTable),
  assets: many(assetTable),
  labels: many(labelTable),
  externalLinks: many(externalLinkTable),
  sourceRelations: many(taskRelationTable, { relationName: "sourceTask" }),
  targetRelations: many(taskRelationTable, { relationName: "targetTask" }),
  remindersSent: many(taskReminderSentTable),
  customFieldValues: many(customFieldValueTable),
  subscribers: many(taskSubscriberTable),
  mentions: many(taskMentionTable),
  reactions: many(reactionTable),
}));

export const timeEntryTableRelations = relations(timeEntryTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [timeEntryTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [timeEntryTable.userId],
    references: [userTable.id],
  }),
}));

export const activityTableRelations = relations(activityTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [activityTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [activityTable.userId],
    references: [userTable.id],
  }),
}));

export const assetTableRelations = relations(assetTable, ({ one }) => ({
  workspace: one(workspaceTable, {
    fields: [assetTable.workspaceId],
    references: [workspaceTable.id],
  }),
  project: one(projectTable, {
    fields: [assetTable.projectId],
    references: [projectTable.id],
  }),
  task: one(taskTable, {
    fields: [assetTable.taskId],
    references: [taskTable.id],
  }),
  activity: one(activityTable, {
    fields: [assetTable.activityId],
    references: [activityTable.id],
  }),
  creator: one(userTable, {
    fields: [assetTable.createdBy],
    references: [userTable.id],
  }),
  page: one(pageTable, {
    fields: [assetTable.pageId],
    references: [pageTable.id],
  }),
}));

export const labelTableRelations = relations(labelTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [labelTable.taskId],
    references: [taskTable.id],
  }),
}));

export const notificationTableRelations = relations(
  notificationTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [notificationTable.userId],
      references: [userTable.id],
      relationName: "notificationUser",
    }),
    actor: one(userTable, {
      fields: [notificationTable.actorId],
      references: [userTable.id],
      relationName: "notificationActor",
    }),
    workspace: one(workspaceTable, {
      fields: [notificationTable.workspaceId],
      references: [workspaceTable.id],
    }),
  }),
);

export const userNotificationPreferenceTableRelations = relations(
  userNotificationPreferenceTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [userNotificationPreferenceTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const userNotificationWorkspaceRuleTableRelations = relations(
  userNotificationWorkspaceRuleTable,
  ({ one, many }) => ({
    user: one(userTable, {
      fields: [userNotificationWorkspaceRuleTable.userId],
      references: [userTable.id],
    }),
    workspace: one(workspaceTable, {
      fields: [userNotificationWorkspaceRuleTable.workspaceId],
      references: [workspaceTable.id],
    }),
    selectedProjects: many(userNotificationWorkspaceProjectTable),
  }),
);

export const userNotificationWorkspaceProjectTableRelations = relations(
  userNotificationWorkspaceProjectTable,
  ({ one }) => ({
    workspaceRule: one(userNotificationWorkspaceRuleTable, {
      fields: [
        userNotificationWorkspaceProjectTable.workspaceId,
        userNotificationWorkspaceProjectTable.workspaceRuleId,
      ],
      references: [
        userNotificationWorkspaceRuleTable.workspaceId,
        userNotificationWorkspaceRuleTable.id,
      ],
    }),
    project: one(projectTable, {
      fields: [
        userNotificationWorkspaceProjectTable.workspaceId,
        userNotificationWorkspaceProjectTable.projectId,
      ],
      references: [projectTable.workspaceId, projectTable.id],
    }),
  }),
);

export const githubIntegrationTableRelations = relations(
  githubIntegrationTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [githubIntegrationTable.projectId],
      references: [projectTable.id],
    }),
  }),
);

export const teamTableRelations = relations(teamTable, ({ one, many }) => ({
  workspace: one(workspaceTable, {
    fields: [teamTable.workspaceId],
    references: [workspaceTable.id],
  }),
  teamMembers: many(teamMemberTable),
}));

export const teamMemberTableRelations = relations(
  teamMemberTable,
  ({ one }) => ({
    team: one(teamTable, {
      fields: [teamMemberTable.teamId],
      references: [teamTable.id],
    }),
    user: one(userTable, {
      fields: [teamMemberTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const invitationTableRelations = relations(
  invitationTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [invitationTable.workspaceId],
      references: [workspaceTable.id],
    }),
    inviter: one(userTable, {
      fields: [invitationTable.inviterId],
      references: [userTable.id],
    }),
  }),
);

export const workspaceRoleTableRelations = relations(
  workspaceRoleTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [workspaceRoleTable.workspaceId],
      references: [workspaceTable.id],
    }),
  }),
);

export const apikeyTableRelations = relations(apikeyTable, ({ one }) => ({
  user: one(userTable, {
    fields: [apikeyTable.referenceId],
    references: [userTable.id],
  }),
}));

export const integrationTableRelations = relations(
  integrationTable,
  ({ one, many }) => ({
    project: one(projectTable, {
      fields: [integrationTable.projectId],
      references: [projectTable.id],
    }),
    externalLinks: many(externalLinkTable),
  }),
);

export const taskRelationTableRelations = relations(
  taskRelationTable,
  ({ one }) => ({
    sourceTask: one(taskTable, {
      fields: [taskRelationTable.sourceTaskId],
      references: [taskTable.id],
      relationName: "sourceTask",
    }),
    targetTask: one(taskTable, {
      fields: [taskRelationTable.targetTaskId],
      references: [taskTable.id],
      relationName: "targetTask",
    }),
  }),
);

export const externalLinkTableRelations = relations(
  externalLinkTable,
  ({ one }) => ({
    task: one(taskTable, {
      fields: [externalLinkTable.taskId],
      references: [taskTable.id],
    }),
    integration: one(integrationTable, {
      fields: [externalLinkTable.integrationId],
      references: [integrationTable.id],
    }),
  }),
);

export const taskLinkTableRelations = relations(taskLinkTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [taskLinkTable.taskId],
    references: [taskTable.id],
  }),
  creator: one(userTable, {
    fields: [taskLinkTable.createdBy],
    references: [userTable.id],
    relationName: "taskLinkCreator",
  }),
}));

export const taskReminderSentTableRelations = relations(
  taskReminderSentTable,
  ({ one }) => ({
    task: one(taskTable, {
      fields: [taskReminderSentTable.taskId],
      references: [taskTable.id],
    }),
  }),
);

export const commentTableRelations = relations(commentTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [commentTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [commentTable.userId],
    references: [userTable.id],
  }),
}));

export const customFieldDefinitionTableRelations = relations(
  customFieldDefinitionTable,
  ({ one, many }) => ({
    project: one(projectTable, {
      fields: [customFieldDefinitionTable.projectId],
      references: [projectTable.id],
    }),
    values: many(customFieldValueTable),
  }),
);

export const customFieldValueTableRelations = relations(
  customFieldValueTable,
  ({ one }) => ({
    field: one(customFieldDefinitionTable, {
      fields: [customFieldValueTable.fieldId],
      references: [customFieldDefinitionTable.id],
    }),
    task: one(taskTable, {
      fields: [customFieldValueTable.taskId],
      references: [taskTable.id],
    }),
  }),
);

export const favoriteTableRelations = relations(favoriteTable, ({ one }) => ({
  user: one(userTable, {
    fields: [favoriteTable.userId],
    references: [userTable.id],
  }),
  workspace: one(workspaceTable, {
    fields: [favoriteTable.workspaceId],
    references: [workspaceTable.id],
  }),
  project: one(projectTable, {
    fields: [favoriteTable.projectId],
    references: [projectTable.id],
  }),
}));

export const recentVisitTableRelations = relations(
  recentVisitTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [recentVisitTable.userId],
      references: [userTable.id],
    }),
    workspace: one(workspaceTable, {
      fields: [recentVisitTable.workspaceId],
      references: [workspaceTable.id],
    }),
    project: one(projectTable, {
      fields: [recentVisitTable.projectId],
      references: [projectTable.id],
    }),
  }),
);

export const stickyTableRelations = relations(stickyTable, ({ one }) => ({
  user: one(userTable, {
    fields: [stickyTable.userId],
    references: [userTable.id],
  }),
  workspace: one(workspaceTable, {
    fields: [stickyTable.workspaceId],
    references: [workspaceTable.id],
  }),
}));

export const quickLinkTableRelations = relations(quickLinkTable, ({ one }) => ({
  user: one(userTable, {
    fields: [quickLinkTable.userId],
    references: [userTable.id],
  }),
  workspace: one(workspaceTable, {
    fields: [quickLinkTable.workspaceId],
    references: [workspaceTable.id],
  }),
}));

export const homePreferenceTableRelations = relations(
  homePreferenceTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [homePreferenceTable.userId],
      references: [userTable.id],
    }),
    workspace: one(workspaceTable, {
      fields: [homePreferenceTable.workspaceId],
      references: [workspaceTable.id],
    }),
  }),
);

export const cycleTableRelations = relations(cycleTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [cycleTable.projectId],
    references: [projectTable.id],
  }),
  owner: one(userTable, {
    fields: [cycleTable.ownerId],
    references: [userTable.id],
  }),
  createdByUser: one(userTable, {
    fields: [cycleTable.createdBy],
    references: [userTable.id],
  }),
  cycleTasks: many(cycleTaskTable),
}));

export const cycleTaskTableRelations = relations(cycleTaskTable, ({ one }) => ({
  cycle: one(cycleTable, {
    fields: [cycleTaskTable.cycleId],
    references: [cycleTable.id],
  }),
  task: one(taskTable, {
    fields: [cycleTaskTable.taskId],
    references: [taskTable.id],
  }),
  addedByUser: one(userTable, {
    fields: [cycleTaskTable.addedBy],
    references: [userTable.id],
  }),
}));

export const moduleTableRelations = relations(moduleTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [moduleTable.projectId],
    references: [projectTable.id],
  }),
  lead: one(userTable, {
    fields: [moduleTable.leadId],
    references: [userTable.id],
  }),
  createdByUser: one(userTable, {
    fields: [moduleTable.createdBy],
    references: [userTable.id],
  }),
  moduleTasks: many(moduleTaskTable),
  members: many(moduleMemberTable),
  links: many(moduleLinkTable),
}));

export const moduleTaskTableRelations = relations(
  moduleTaskTable,
  ({ one }) => ({
    module: one(moduleTable, {
      fields: [moduleTaskTable.moduleId],
      references: [moduleTable.id],
    }),
    task: one(taskTable, {
      fields: [moduleTaskTable.taskId],
      references: [taskTable.id],
    }),
    createdByUser: one(userTable, {
      fields: [moduleTaskTable.createdBy],
      references: [userTable.id],
    }),
  }),
);

export const moduleMemberTableRelations = relations(
  moduleMemberTable,
  ({ one }) => ({
    module: one(moduleTable, {
      fields: [moduleMemberTable.moduleId],
      references: [moduleTable.id],
    }),
    user: one(userTable, {
      fields: [moduleMemberTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const moduleLinkTableRelations = relations(
  moduleLinkTable,
  ({ one }) => ({
    module: one(moduleTable, {
      fields: [moduleLinkTable.moduleId],
      references: [moduleTable.id],
    }),
    createdByUser: one(userTable, {
      fields: [moduleLinkTable.createdBy],
      references: [userTable.id],
    }),
  }),
);

export const estimateTableRelations = relations(
  estimateTable,
  ({ one, many }) => ({
    project: one(projectTable, {
      fields: [estimateTable.projectId],
      references: [projectTable.id],
    }),
    createdByUser: one(userTable, {
      fields: [estimateTable.createdBy],
      references: [userTable.id],
    }),
    points: many(estimatePointTable),
  }),
);

export const estimatePointTableRelations = relations(
  estimatePointTable,
  ({ one, many }) => ({
    estimate: one(estimateTable, {
      fields: [estimatePointTable.estimateId],
      references: [estimateTable.id],
    }),
    tasks: many(taskTable),
  }),
);

export const taskAssigneeTableRelations = relations(
  taskAssigneeTable,
  ({ one }) => ({
    task: one(taskTable, {
      fields: [taskAssigneeTable.taskId],
      references: [taskTable.id],
    }),
    user: one(userTable, {
      fields: [taskAssigneeTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const taskSubscriberTableRelations = relations(
  taskSubscriberTable,
  ({ one }) => ({
    task: one(taskTable, {
      fields: [taskSubscriberTable.taskId],
      references: [taskTable.id],
    }),
    user: one(userTable, {
      fields: [taskSubscriberTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const taskMentionTableRelations = relations(
  taskMentionTable,
  ({ one }) => ({
    task: one(taskTable, {
      fields: [taskMentionTable.taskId],
      references: [taskTable.id],
    }),
    user: one(userTable, {
      fields: [taskMentionTable.userId],
      references: [userTable.id],
    }),
    comment: one(activityTable, {
      fields: [taskMentionTable.commentId],
      references: [activityTable.id],
    }),
  }),
);

export const reactionTableRelations = relations(reactionTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [reactionTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [reactionTable.userId],
    references: [userTable.id],
  }),
  comment: one(activityTable, {
    fields: [reactionTable.commentId],
    references: [activityTable.id],
  }),
}));

export const savedViewTableRelations = relations(savedViewTable, ({ one }) => ({
  workspace: one(workspaceTable, {
    fields: [savedViewTable.workspaceId],
    references: [workspaceTable.id],
  }),
  project: one(projectTable, {
    fields: [savedViewTable.projectId],
    references: [projectTable.id],
  }),
  owner: one(userTable, {
    fields: [savedViewTable.ownerId],
    references: [userTable.id],
  }),
  locker: one(userTable, {
    fields: [savedViewTable.lockedBy],
    references: [userTable.id],
  }),
}));

export const intakeItemTableRelations = relations(
  intakeItemTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [intakeItemTable.projectId],
      references: [projectTable.id],
    }),
    task: one(taskTable, {
      fields: [intakeItemTable.taskId],
      references: [taskTable.id],
    }),
    duplicateOf: one(taskTable, {
      fields: [intakeItemTable.duplicateOfTaskId],
      references: [taskTable.id],
    }),
    submitter: one(userTable, {
      fields: [intakeItemTable.submittedBy],
      references: [userTable.id],
    }),
    triager: one(userTable, {
      fields: [intakeItemTable.triagedBy],
      references: [userTable.id],
    }),
  }),
);

export const taskDraftTableRelations = relations(taskDraftTable, ({ one }) => ({
  workspace: one(workspaceTable, {
    fields: [taskDraftTable.workspaceId],
    references: [workspaceTable.id],
  }),
  project: one(projectTable, {
    fields: [taskDraftTable.projectId],
    references: [projectTable.id],
  }),
  owner: one(userTable, {
    fields: [taskDraftTable.createdBy],
    references: [userTable.id],
  }),
  parentTask: one(taskTable, {
    fields: [taskDraftTable.parentTaskId],
    references: [taskTable.id],
  }),
}));

export const projectAutomationTableRelations = relations(
  projectAutomationTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [projectAutomationTable.projectId],
      references: [projectTable.id],
    }),
    closeColumn: one(columnTable, {
      fields: [projectAutomationTable.autoCloseColumnId],
      references: [columnTable.id],
    }),
    updatedByUser: one(userTable, {
      fields: [projectAutomationTable.updatedBy],
      references: [userTable.id],
    }),
  }),
);

export const taskTemplateTableRelations = relations(
  taskTemplateTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [taskTemplateTable.projectId],
      references: [projectTable.id],
    }),
    column: one(columnTable, {
      fields: [taskTemplateTable.columnId],
      references: [columnTable.id],
    }),
    estimatePoint: one(estimatePointTable, {
      fields: [taskTemplateTable.estimatePointId],
      references: [estimatePointTable.id],
    }),
    creator: one(userTable, {
      fields: [taskTemplateTable.createdBy],
      references: [userTable.id],
    }),
  }),
);

export const analyticsReportTableRelations = relations(
  analyticsReportTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [analyticsReportTable.workspaceId],
      references: [workspaceTable.id],
    }),
    owner: one(userTable, {
      fields: [analyticsReportTable.ownerId],
      references: [userTable.id],
    }),
  }),
);

export const pageTableRelations = relations(pageTable, ({ one, many }) => ({
  workspace: one(workspaceTable, {
    fields: [pageTable.workspaceId],
    references: [workspaceTable.id],
  }),
  project: one(projectTable, {
    fields: [pageTable.projectId],
    references: [projectTable.id],
  }),
  parent: one(pageTable, {
    fields: [pageTable.parentId],
    references: [pageTable.id],
    relationName: "page_parent",
  }),
  children: many(pageTable, { relationName: "page_parent" }),
  owner: one(userTable, {
    fields: [pageTable.ownerId],
    references: [userTable.id],
  }),
  versions: many(pageVersionTable),
  references: many(pageReferenceTable),
  assets: many(assetTable),
}));

export const pageTemplateTableRelations = relations(
  pageTemplateTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [pageTemplateTable.workspaceId],
      references: [workspaceTable.id],
    }),
    project: one(projectTable, {
      fields: [pageTemplateTable.projectId],
      references: [projectTable.id],
    }),
  }),
);

export const pageVersionTableRelations = relations(
  pageVersionTable,
  ({ one }) => ({
    page: one(pageTable, {
      fields: [pageVersionTable.pageId],
      references: [pageTable.id],
    }),
    owner: one(userTable, {
      fields: [pageVersionTable.ownerId],
      references: [userTable.id],
    }),
  }),
);

export const pageReferenceTableRelations = relations(
  pageReferenceTable,
  ({ one }) => ({
    page: one(pageTable, {
      fields: [pageReferenceTable.pageId],
      references: [pageTable.id],
    }),
  }),
);

export const taskExportTableRelations = relations(
  taskExportTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [taskExportTable.workspaceId],
      references: [workspaceTable.id],
    }),
    requester: one(userTable, {
      fields: [taskExportTable.requestedBy],
      references: [userTable.id],
    }),
    file: one(taskExportFileTable, {
      fields: [taskExportTable.id],
      references: [taskExportFileTable.exportId],
    }),
  }),
);

export const taskExportFileTableRelations = relations(
  taskExportFileTable,
  ({ one }) => ({
    export: one(taskExportTable, {
      fields: [taskExportFileTable.exportId],
      references: [taskExportTable.id],
    }),
  }),
);

export const workspaceWebhookTableRelations = relations(
  workspaceWebhookTable,
  ({ one, many }) => ({
    workspace: one(workspaceTable, {
      fields: [workspaceWebhookTable.workspaceId],
      references: [workspaceTable.id],
    }),
    creator: one(userTable, {
      fields: [workspaceWebhookTable.createdBy],
      references: [userTable.id],
    }),
    deliveries: many(webhookDeliveryTable),
  }),
);

export const webhookDeliveryTableRelations = relations(
  webhookDeliveryTable,
  ({ one }) => ({
    webhook: one(workspaceWebhookTable, {
      fields: [webhookDeliveryTable.webhookId],
      references: [workspaceWebhookTable.id],
    }),
  }),
);

// B12 publication tables. Project, task and user keep their own relations;
// these are only read through the query builder.
export const projectPublicationTableRelations = relations(
  projectPublicationTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [projectPublicationTable.projectId],
      references: [projectTable.id],
    }),
    publicationPublisher: one(userTable, {
      fields: [projectPublicationTable.publishedBy],
      references: [userTable.id],
    }),
  }),
);

export const publicBoardBlockTableRelations = relations(
  publicBoardBlockTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [publicBoardBlockTable.projectId],
      references: [projectTable.id],
    }),
    blockedUser: one(userTable, {
      fields: [publicBoardBlockTable.userId],
      references: [userTable.id],
    }),
    blockedByUser: one(userTable, {
      fields: [publicBoardBlockTable.blockedBy],
      references: [userTable.id],
    }),
  }),
);

export const taskVoteTableRelations = relations(taskVoteTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [taskVoteTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [taskVoteTable.userId],
    references: [userTable.id],
  }),
}));

export const instanceSettingTableRelations = relations(
  instanceSettingTable,
  ({ one }) => ({
    updatedByUser: one(userTable, {
      fields: [instanceSettingTable.updatedBy],
      references: [userTable.id],
    }),
  }),
);

export const agentTableRelations = relations(agentTable, ({ one, many }) => ({
  user: one(userTable, {
    fields: [agentTable.userId],
    references: [userTable.id],
    relationName: "agentUser",
  }),
  workspace: one(workspaceTable, {
    fields: [agentTable.workspaceId],
    references: [workspaceTable.id],
  }),
  owner: one(userTable, {
    fields: [agentTable.ownerId],
    references: [userTable.id],
    relationName: "agentOwner",
  }),
  runs: many(aiRunTable),
}));

export const aiRunTableRelations = relations(aiRunTable, ({ one, many }) => ({
  agent: one(agentTable, {
    fields: [aiRunTable.agentId],
    references: [agentTable.id],
  }),
  workspace: one(workspaceTable, {
    fields: [aiRunTable.workspaceId],
    references: [workspaceTable.id],
  }),
  task: one(taskTable, {
    fields: [aiRunTable.taskId],
    references: [taskTable.id],
  }),
  principal: one(userTable, {
    fields: [aiRunTable.principalUserId],
    references: [userTable.id],
  }),
  steps: many(aiRunStepTable),
  approvals: many(aiApprovalTable),
}));

export const aiRunStepTableRelations = relations(aiRunStepTable, ({ one }) => ({
  run: one(aiRunTable, {
    fields: [aiRunStepTable.runId],
    references: [aiRunTable.id],
  }),
}));

export const aiApprovalTableRelations = relations(
  aiApprovalTable,
  ({ one }) => ({
    run: one(aiRunTable, {
      fields: [aiApprovalTable.runId],
      references: [aiRunTable.id],
    }),
    step: one(aiRunStepTable, {
      fields: [aiApprovalTable.stepId],
      references: [aiRunStepTable.id],
    }),
    requestedFor: one(userTable, {
      fields: [aiApprovalTable.requestedForUserId],
      references: [userTable.id],
    }),
  }),
);

export const flowAlertTableRelations = relations(flowAlertTable, ({ one }) => ({
  project: one(projectTable, {
    fields: [flowAlertTable.projectId],
    references: [projectTable.id],
  }),
  notifiedUser: one(userTable, {
    fields: [flowAlertTable.notifiedUserId],
    references: [userTable.id],
  }),
}));

export const automationRuleTableRelations = relations(
  automationRuleTable,
  ({ one, many }) => ({
    project: one(projectTable, {
      fields: [automationRuleTable.projectId],
      references: [projectTable.id],
    }),
    creator: one(userTable, {
      fields: [automationRuleTable.createdBy],
      references: [userTable.id],
    }),
    runs: many(automationRunTable),
  }),
);

export const automationRunTableRelations = relations(
  automationRunTable,
  ({ one }) => ({
    rule: one(automationRuleTable, {
      fields: [automationRunTable.ruleId],
      references: [automationRuleTable.id],
    }),
    task: one(taskTable, {
      fields: [automationRunTable.taskId],
      references: [taskTable.id],
    }),
  }),
);
