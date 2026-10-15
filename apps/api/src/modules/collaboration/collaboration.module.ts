import { Module } from "@nestjs/common";
import { ActivityController, CommentsController, NotificationsController, SavedViewsController, TasksController } from "./collaboration.controller";
import { CollaborationService } from "./collaboration.service";
import { TasksService } from "./tasks.service";

@Module({
  controllers: [TasksController, CommentsController, ActivityController, NotificationsController, SavedViewsController],
  providers: [TasksService, CollaborationService],
  exports: [TasksService],
})
export class CollaborationModule {}
