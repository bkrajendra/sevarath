import { Module } from '@nestjs/common';
import { CampusModule } from '../campus/campus.module';
import { BookmarksController } from './bookmarks.controller';
import { LocationBookmarksService } from './location-bookmarks.service';

@Module({
  imports: [CampusModule],
  controllers: [BookmarksController],
  providers: [LocationBookmarksService],
})
export class BookmarksModule {}
