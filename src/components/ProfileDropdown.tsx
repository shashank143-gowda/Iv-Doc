"use client";

import { Link } from "@tanstack/react-router";
import { FileText, FolderKanban, Settings, User, Library } from "lucide-react";

import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ProfileDropdown() {
  const auth = useAuth();

  if (!auth.user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[var(--color-mist)]"
          aria-label="Open profile menu"
        >
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Profile</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">Account</p>
            <p className="text-xs text-muted-foreground truncate">
              {auth.user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/projects" className="cursor-pointer">
            <FolderKanban className="h-4 w-4" />
            Projects
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            to="/documents"
            className="cursor-pointer"
          >
            <FileText className="h-4 w-4" />
            Documents
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            to="/corpus"
            className="cursor-pointer"
          >
            <Library className="h-4 w-4" />
            Corpus
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            to="/settings"
            className="cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
