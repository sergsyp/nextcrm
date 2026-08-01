"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UserSearchCombobox } from "@/components/ui/user-search-combobox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createTaskInBoard } from "@/actions/projects/create-task-in-board";
import { useTranslations } from "next-intl";

type Props = {
  boardId: string;
  sections: any;
};

const NewTaskInProjectDialog = ({ boardId, sections }: Props) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();
  const t = useTranslations("ProjectsPage.newTask");
  const common = useTranslations("Common");

  const formSchema = z.object({
    title: z.string().min(3).max(255),
    user: z.string().min(3).max(255),
    dueDateAt: z.date(),
    priority: z.string().min(3).max(10),
    section: z.string().min(3).max(255),
    content: z.string().min(3).max(500),
  });

  type NewAccountFormValues = z.infer<typeof formSchema>;

  const form = useForm<NewAccountFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dueDateAt: new Date(),
    },
  });

  //Actions

  const onSubmit = async (data: NewAccountFormValues) => {
    console.log(data);
    setIsLoading(true);
    try {
      const result = await createTaskInBoard({
        boardId,
        section: data.section,
        title: data.title,
        priority: data.priority,
        content: data.content,
        user: data.user,
        dueDateAt: data.dueDateAt,
      });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(t("successMsg"));
      }
    } catch (error: any) {
      toast.error(error?.message);
    } finally {
      setIsLoading(false);
      setOpen(false);
      form.reset({
        title: "",
        content: "",
        user: "",
        priority: "",
        section: "",
      });
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="px-2">{t("trigger")}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex flex-col gap-2 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("nameLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          disabled={isLoading}
                          placeholder={t("namePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("descLabel")}</FormLabel>
                      <FormControl>
                        <Textarea
                          disabled={isLoading}
                          placeholder={t("descPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueDateAt"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>{t("dueDateLabel")}</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-[240px] pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>{t("dueDatePlaceholder")}</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            //@ts-ignore
                            //TODO: fix this
                            onSelect={field.onChange}
                            disabled={(date) => date < new Date("1900-01-01")}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="user"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{common("assignedTo")}</FormLabel>
                      <FormControl>
                        <UserSearchCombobox
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder={t("assignedToPlaceholder")}
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="section"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("sectionLabel")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("sectionPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sections.map((section: any) => (
                            <SelectItem key={section.id} value={section.id}>
                              {section.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{common("priorityLabel")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={common("priorityPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="low">{common("low")}</SelectItem>
                          <SelectItem value="medium">{common("medium")}</SelectItem>
                          <SelectItem value="high">{common("high")}</SelectItem>
                          <SelectItem value="critical">{common("critical")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit">{t("create")}</Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NewTaskInProjectDialog;
