import { FolderSearch, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function EmptyState() {
  return (
    <Card className="mx-auto mt-8 max-w-md items-center text-center">
      <CardHeader className="items-center">
        <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FolderSearch className="size-6" aria-hidden />
        </div>
        <CardTitle className="text-base">
          No investigation loaded
        </CardTitle>
        <CardDescription>
          Upload synthetic evidence to begin an investigation. Evidence
          ingestion is not implemented yet — this workspace establishes the
          application foundation for later milestones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button disabled className="gap-2" title="Ingestion is not implemented yet">
          <Upload className="size-4" aria-hidden />
          Upload Evidence
        </Button>
      </CardContent>
    </Card>
  );
}
