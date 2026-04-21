#!/usr/bin/env ruby
#
# Check for changed posts

Jekyll::Hooks.register :posts, :post_init do |post|

  commit_num = `"C:\\Program Files\\Git\\bin\\git.exe" rev-list --count HEAD "#{ post.path }"`

  if commit_num.to_i > 1
    lastmod_date = `"C:\\Program Files\\Git\\bin\\git.exe" log -1 --pretty="%ad" --date=iso "#{ post.path }"`
    post.data['last_modified_at'] = lastmod_date
  end

end
