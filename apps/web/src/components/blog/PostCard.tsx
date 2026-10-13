import Link from "next/link";
import { type BlogPost, blogPostPath, readingMinutes } from "@/lib/blog";
import { BlogCover } from "./BlogCover";
import { PostMeta, TagList } from "./PostMeta";

/**
 * One post in a listing. The title link stretches over the whole card, so the card is a single
 * tab stop and the cover is not announced as a second link to the same page.
 */
export function PostCard({ post, featured = false, headingLevel }: { post: BlogPost; featured?: boolean; headingLevel: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className={featured ? "v10-postcard v10-postcard--featured" : "v10-postcard"}>
      <div className="v10-postcard__cover">
        <BlogCover title={post.title} tags={post.tags} />
      </div>
      <div className="v10-postcard__body">
        <PostMeta date={post.date} minutes={readingMinutes(post.body)} />
        <Heading className="v10-postcard__title">
          <Link href={blogPostPath(post.slug)}>{post.title}</Link>
        </Heading>
        <p className="v10-postcard__desc">{post.description}</p>
        <TagList tags={post.tags} />
      </div>
    </article>
  );
}
